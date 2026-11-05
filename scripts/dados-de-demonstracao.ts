/**
 * Popula uma CONTA DE DEMONSTRAÇÃO com um volume plausível de cadastros, para
 * alguém percorrer o sistema inteiro e encontrar telas cheias — listas com
 * dezenas de linhas, filtros que de fato filtram, planos em estados
 * diferentes, emissões em todos os status.
 *
 * Diferente de `scripts/cenario-de-teste.ts`, que monta o MÍNIMO para um
 * cenário específico (a identidade multiconta do Epic 6) e para aí. Este vai
 * do outro lado: cria a conta se ela não existir e enche os módulos de
 * negócio. Os dois são complementares, nesta ordem.
 *
 * Serve aos DOIS ambientes, e é essa a razão de ele existir separado:
 *
 *   - banco LOCAL (`npm run dev:local`): roda sozinho, com senha padrão;
 *   - banco REMOTO (um ambiente de demonstração servido pela internet): só
 *     com `DEMO_PERMITIR_BANCO_REMOTO=sim` e `DEMO_SENHA` definida.
 *
 * A trava do remoto não é desconfiança do propósito — povoar um ambiente para
 * alguém de fora testar é uso legítimo. É contra o remoto por ACIDENTE: o
 * `.env.local` aponta para o Neon que produção usa, então rodar isto sem
 * variável nenhuma, de dentro do projeto, escreveria lá sem perguntar.
 *
 * Os dados ficam num TENANT PRÓPRIO (ver CONTA_CNPJ), nunca misturados a uma
 * conta de uso real: é o isolamento que o produto já tem (AD-1) servindo de
 * contenção, e é o que permite remover a demonstração um dia sem tocar no
 * dado de ninguém.
 *
 * Idempotente: tudo entra por `upsert` nas chaves únicas que o schema já tem
 * (`@@unique([contaId, nome])` e companhia), então rodar duas vezes não
 * duplica nada. As entidades sem chave única — Pessoa, ServicoEmissao — são
 * procuradas antes de criar.
 *
 * Determinístico de propósito: nenhuma data ou quantidade sai de
 * `Math.random()`. Duas execuções têm de produzir o mesmo cadastro, senão "o
 * plano está atrasado?" deixa de ser uma pergunta respondível.
 *
 * Uso local: `npm run dev:local`, que o chama sozinho num banco novo.
 * Uso remoto: `DEMO_PERMITIR_BANCO_REMOTO=sim DEMO_SENHA=... npm run dados:demo`.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import dotenv from "dotenv";

// `.env.local` só preenche o que ainda não veio do ambiente — o padrão do
// dotenv, que não sobrescreve. É isso que mantém `dev-local.mjs` no comando:
// ele exporta a DATABASE_URL do banco local antes de chamar este script, e
// esse valor continua vencendo o do arquivo.
//
// Carregar o arquivo não afrouxa nada: a DATABASE_URL dele aponta para
// produção, e `bancoRemoto()` continua recusando o banco remoto sem
// autorização explícita. O que isto evita é ter de extrair a URL do arquivo à
// mão para rodar o script onde ele deve rodar.
dotenv.config({ path: ".env.local", quiet: true });

const prisma = new PrismaClient();

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// A conta de demonstração é um TENANT PRÓPRIO, e não dados soltos dentro de
// uma conta existente. É o isolamento que o produto já tem (AD-1) fazendo o
// trabalho: quem entra nela não vê nada das outras, e apagá-la um dia não
// tromba com dado de ninguém.
//
// O CNPJ é sinteticamente óbvio de propósito. Um CNPJ "realista" poderia ser
// o de uma empresa que existe de verdade, e este cadastro não é dela.
const CONTA_NOME = process.env.DEMO_CONTA_NOME ?? "Alfa Engenharia e Manutenção";
const CONTA_CNPJ = process.env.DEMO_CONTA_CNPJ ?? "11.111.111/0001-11";

// Domínio dos e-mails das identidades. `example.com` é reservado por RFC
// justamente para este uso: parece um endereço de verdade na tela, e não pode
// colidir com o endereço de nenhuma pessoa real nem receber mensagem.
const DOMINIO = process.env.DEMO_DOMINIO ?? "alfa.example.com";

/// Senha de todas as identidades semeadas.
///
/// Sem valor padrão quando o banco é REMOTO. O padrão fraco existe para o
/// banco local, que não é alcançável pela internet; num banco servido por uma
/// tela de login pública, uma senha conhecida publicada num script do
/// repositório é uma porta aberta, não um atalho de teste.
function senhaExigida(remoto: boolean): string {
  const informada = process.env.DEMO_SENHA ?? process.env.CENARIO_SENHA;
  if (informada) return informada;
  if (remoto) {
    throw new Error(
      "[demo] DEMO_SENHA é obrigatória quando o banco não é local. As identidades " +
        "semeadas entram por uma tela de login alcançável pela internet, e a senha " +
        "padrão deste script é pública (está no repositório).",
    );
  }
  return "teste1234";
}

// Âncora de tempo, fixada no início do dia para que as datas derivadas não
// mudem de posição conforme a hora em que o script roda — "vence em 3 dias"
// precisa continuar sendo 3 dias se alguém rodar isto de novo à noite.
const HOJE = new Date();
HOJE.setHours(0, 0, 0, 0);

function diasAtras(dias: number): Date {
  return new Date(HOJE.getTime() - dias * MS_POR_DIA);
}

function emDias(dias: number): Date {
  return new Date(HOJE.getTime() + dias * MS_POR_DIA);
}

/// Hora do dia sobre uma data, na convenção de hora de parede em UTC que o
/// resto do produto usa para lançamento de serviço.
function as(data: Date, hora: number, minuto = 0): Date {
  const d = new Date(data);
  d.setUTCHours(hora, minuto, 0, 0);
  return d;
}

/// Responde se o banco apontado é local, e recusa o remoto sem autorização
/// explícita.
///
/// A trava não é "nunca remoto": povoar um ambiente de demonstração para
/// alguém de fora testar é um uso legítimo, e foi para isso que este script
/// passou a aceitar o banco remoto. A trava é contra o remoto por ACIDENTE —
/// o `.env.local` aponta para o banco que produção usa, então rodar este
/// script sem variável nenhuma, de dentro do projeto, escreveria lá. Quem
/// quer isso diz que quer.
function bancoRemoto(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("[demo] DATABASE_URL ausente.");

  const local = url.includes("@127.0.0.1:") || url.includes("@localhost:");
  if (local) return false;

  if (process.env.DEMO_PERMITIR_BANCO_REMOTO !== "sim") {
    throw new Error(
      "[demo] A DATABASE_URL não é local e este script escreve centenas de linhas. " +
        "Se é de propósito — povoar um ambiente de demonstração —, rode com " +
        "DEMO_PERMITIR_BANCO_REMOTO=sim e DEMO_SENHA definida. Para o banco de " +
        "desenvolvimento, use `npm run dev:local`.",
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Catálogos. Nomes de equipamento industrial de verdade, e não "Ativo 1": a
// tela só mostra o que a busca e a ordenação realmente fazem quando os nomes
// têm o formato irregular que nomes reais têm.
// ---------------------------------------------------------------------------

const EMPRESAS = [
  {
    razaoSocial: "Transportadora Vale Verde Ltda",
    nomeFantasia: "Vale Verde",
    cnpj: "04.512.883/0001-67",
  },
  {
    razaoSocial: "Agroindustrial Campo Alto S.A.",
    nomeFantasia: "Campo Alto",
    cnpj: "17.904.226/0001-04",
  },
  {
    razaoSocial: "Metalúrgica São Jorge Ltda",
    nomeFantasia: "Metal São Jorge",
    cnpj: "28.336.471/0001-85",
  },
  {
    razaoSocial: "Construtora Ipê Amarelo Eireli",
    nomeFantasia: "Ipê Amarelo",
    cnpj: "33.675.012/0001-29",
  },
  // Pessoa física: o cadastro aceita CNPJ ou CPF, e sem uma linha assim a
  // tela nunca mostra a coluna de documento no formato de CPF.
  {
    razaoSocial: "José Carlos Ferreira Locações",
    nomeFantasia: "JC Locações",
    cpf: "472.118.330-55",
  },
];

const LOCAIS = [
  { nome: "Pátio Central", endereco: "Rod. BR-050, km 112 — Catalão/GO" },
  { nome: "Galpão de Manutenção", endereco: "Av. Industrial, 1480 — Catalão/GO" },
  { nome: "Unidade Norte", endereco: "Fazenda Boa Vista, s/n — Ipameri/GO" },
  { nome: "Oficina Terceirizada", endereco: "R. dos Mecânicos, 77 — Uberlândia/MG" },
  { nome: "Depósito Sul", endereco: "Av. Paulo de Frontin, 902 — Araguari/MG" },
];

const TIPOS = [
  { nome: "Caminhão basculante", descricao: "Caminhões de caçamba para transporte de granel." },
  { nome: "Escavadeira hidráulica", descricao: "Escavadeiras sobre esteira." },
  { nome: "Empilhadeira", descricao: "Empilhadeiras a gás e elétricas." },
  { nome: "Compressor de ar", descricao: "Compressores estacionários de parafuso." },
  { nome: "Gerador diesel", descricao: "Grupos geradores de emergência." },
  { nome: "Ponte rolante", descricao: "Pontes e talhas do galpão de manutenção." },
  { nome: "Trator agrícola", descricao: "Tratores de pneu da unidade Norte." },
];

const CARGOS = [
  "Mecânico",
  "Eletricista industrial",
  "Supervisor de manutenção",
  "Operador de máquinas",
  "Técnico em segurança do trabalho",
  "Auxiliar de manutenção",
  "Soldador",
];

const FUNCOES = [
  "Manutenção preventiva",
  "Manutenção corretiva",
  "Inspeção",
  "Lubrificação",
  "Operação",
  "Apoio",
  "Caldeiraria",
];

const PESSOAS = [
  { nome: "Adriano Peixoto Lima", cpf: "315.402.778-10", cargo: 0, funcao: 0 },
  { nome: "Beatriz Nogueira Alves", cpf: "408.117.223-46", cargo: 1, funcao: 0 },
  { nome: "Carlos Eduardo Brandão", cpf: "227.930.615-02", cargo: 2, funcao: 2 },
  { nome: "Daniela Furtado Rocha", cpf: "552.308.194-77", cargo: 4, funcao: 2 },
  { nome: "Edson Marques da Silva", cpf: "190.645.802-31", cargo: 0, funcao: 1 },
  { nome: "Fernanda Quirino Matos", cpf: "631.274.509-88", cargo: 3, funcao: 4 },
  { nome: "Gilberto Assunção Reis", cpf: "744.016.332-59", cargo: 6, funcao: 6 },
  { nome: "Helena Vasconcelos Pires", cpf: "826.553.147-20", cargo: 1, funcao: 3 },
  { nome: "Ivan Portela Cardoso", cpf: "073.891.264-13", cargo: 5, funcao: 5 },
  { nome: "Juliana Teixeira Amaral", cpf: "984.627.350-04", cargo: 2, funcao: 2 },
  { nome: "Kleber dos Santos Maia", cpf: "165.743.928-66", cargo: 0, funcao: 3 },
  { nome: "Luciana Barreto Figueiró", cpf: "239.580.471-95", cargo: 4, funcao: 2 },
  { nome: "Marcos Vinícius Dantas", cpf: "317.962.845-38", cargo: 3, funcao: 4 },
  { nome: "Natália Cordeiro Bastos", cpf: "450.238.617-72", cargo: 5, funcao: 5 },
];

// Itens revisionais com os TRÊS controles misturados — dias, km e horas,
// alguns com dois ao mesmo tempo, um só de km e um só de horas. É o que faz a
// coluna de controle ter conteúdo diferente em cada linha, e o que exercita o
// cálculo de próxima revisão (que só olha dias) na presença dos outros.
const ITENS = [
  { nome: "Troca de óleo do motor", categoria: "Lubrificação", grupo: "Motor", diasPadrao: 90, kmPadrao: 10000, horasPadrao: 250 },
  { nome: "Filtro de ar do motor", categoria: "Filtros", grupo: "Motor", diasPadrao: 180, kmPadrao: 20000 },
  { nome: "Filtro de combustível", categoria: "Filtros", grupo: "Motor", diasPadrao: 180, kmPadrao: 20000 },
  { nome: "Filtro separador de água", categoria: "Filtros", grupo: "Motor", diasPadrao: 365 },
  { nome: "Inspeção de freios", categoria: "Segurança", grupo: "Chassi", diasPadrao: 60, kmPadrao: 15000 },
  { nome: "Regulagem de freios", categoria: "Segurança", grupo: "Chassi", diasPadrao: 120 },
  { nome: "Revisão do sistema hidráulico", categoria: "Hidráulica", grupo: "Implemento", diasPadrao: 180, horasPadrao: 1000 },
  { nome: "Troca de mangueiras hidráulicas", categoria: "Hidráulica", grupo: "Implemento", diasPadrao: 730 },
  { nome: "Lubrificação de pinos e buchas", categoria: "Lubrificação", grupo: "Implemento", diasPadrao: 30, horasPadrao: 100 },
  { nome: "Aferição de instrumentos", categoria: "Instrumentação", grupo: "Cabine", diasPadrao: 365 },
  { nome: "Inspeção elétrica geral", categoria: "Elétrica", grupo: "Elétrica", diasPadrao: 180 },
  { nome: "Troca de correias", categoria: "Mecânica", grupo: "Motor", diasPadrao: 365, horasPadrao: 2000 },
  { nome: "Alinhamento e balanceamento", categoria: "Mecânica", grupo: "Chassi", kmPadrao: 25000 },
  { nome: "Teste de carga", categoria: "Segurança", grupo: "Estrutura", diasPadrao: 365 },
  { nome: "Troca do filtro de secador de ar", categoria: "Filtros", grupo: "Pneumática", diasPadrao: 240 },
  { nome: "Análise de óleo lubrificante", categoria: "Lubrificação", grupo: "Motor", horasPadrao: 500 },
];

// Ativos. `tipo` é índice em TIPOS, `empresa` em EMPRESAS (null = equipamento
// próprio), `local` em LOCAIS, e `criadoHa` é quantos dias atrás o ativo
// entrou — é ele, cruzado com o `diasPadrao` dos itens do plano, que decide se
// o plano aparece Atrasado, Vence em breve ou No prazo, porque
// `resolverAtivosDoPlano` calcula a próxima data a partir de `createdAt`. Os
// valores abaixo foram escolhidos para que a tela de Planos mostre os três.
const ATIVOS = [
  { codigo: "CB-001", nome: "Caminhão basculante Volvo FMX 500", tipo: 0, empresa: 0, local: 0, serie: "VLV-FMX-77120", criadoHa: 410, status: "Ativo" },
  { codigo: "CB-002", nome: "Caminhão basculante Mercedes Axor 3344", tipo: 0, empresa: 0, local: 0, serie: "MB-AX-449201", criadoHa: 68, status: "Ativo" },
  { codigo: "CB-003", nome: "Caminhão basculante Scania P360", tipo: 0, empresa: 0, local: 4, serie: "SCN-P36-01884", criadoHa: 20, status: "Ativo" },
  { codigo: "CB-004", nome: "Caminhão basculante Iveco Tector 240", tipo: 0, empresa: 4, local: 0, serie: "IVC-TC-553317", criadoHa: 56, status: "Ativo" },
  { codigo: "CB-005", nome: "Caminhão basculante Ford Cargo 2429", tipo: 0, empresa: null, local: 0, serie: "FRD-CG-220045", criadoHa: 33, status: "Ativo" },
  { codigo: "CB-006", nome: "Caminhão basculante VW Constellation 24.280", tipo: 0, empresa: null, local: 4, criadoHa: 640, status: "Vendido" },
  { codigo: "EH-010", nome: "Escavadeira Caterpillar 320D", tipo: 1, empresa: 1, local: 2, serie: "CAT-320D-66541", criadoHa: 290, status: "Ativo" },
  { codigo: "EH-011", nome: "Escavadeira Komatsu PC200", tipo: 1, empresa: 1, local: 2, serie: "KMT-PC200-9933", criadoHa: 27, status: "Ativo" },
  { codigo: "EH-012", nome: "Escavadeira Hyundai R220LC", tipo: 1, empresa: null, local: 3, serie: "HYU-R220-41007", criadoHa: 10, status: "Ativo" },
  { codigo: "EH-013", nome: "Escavadeira JCB JS205", tipo: 1, empresa: 3, local: 2, criadoHa: 24, status: "Bloqueado" },
  { codigo: "EP-020", nome: "Empilhadeira Hyster H50FT", tipo: 2, empresa: 2, local: 1, serie: "HYS-H50-30218", criadoHa: 395, status: "Ativo" },
  { codigo: "EP-021", nome: "Empilhadeira Yale GLP050", tipo: 2, empresa: 2, local: 1, serie: "YLE-GLP-71664", criadoHa: 70, status: "Ativo" },
  { codigo: "EP-022", nome: "Empilhadeira Toyota 8FGU25", tipo: 2, empresa: null, local: 4, serie: "TYT-8FG-50392", criadoHa: 30, status: "Ativo" },
  { codigo: "EP-023", nome: "Empilhadeira elétrica Still RX20", tipo: 2, empresa: null, local: 1, criadoHa: 15, status: "Inativo" },
  { codigo: "CP-030", nome: "Compressor Atlas Copco GA22", tipo: 3, empresa: 2, local: 1, serie: "ATC-GA22-11287", criadoHa: 520, status: "Ativo" },
  { codigo: "CP-031", nome: "Compressor Schulz SRP 4030", tipo: 3, empresa: null, local: 1, serie: "SCZ-SRP-66030", criadoHa: 40, status: "Ativo" },
  { codigo: "CP-032", nome: "Compressor Chicago Pneumatic CPB40", tipo: 3, empresa: null, local: 3, criadoHa: 72, status: "Ativo" },
  { codigo: "GD-040", nome: "Gerador Stemac 180 kVA", tipo: 4, empresa: null, local: 0, serie: "STM-180-72210", criadoHa: 300, status: "Ativo" },
  { codigo: "GD-041", nome: "Gerador Cummins C150D5", tipo: 4, empresa: null, local: 2, serie: "CMN-C150-83391", criadoHa: 50, status: "Ativo" },
  { codigo: "GD-042", nome: "Gerador Heimer HGM 60", tipo: 4, empresa: 3, local: 4, criadoHa: 29, status: "Ativo" },
  { codigo: "PR-050", nome: "Ponte rolante Munck 10 t", tipo: 5, empresa: null, local: 1, serie: "MNK-10T-00417", criadoHa: 480, status: "Ativo" },
  { codigo: "PR-051", nome: "Ponte rolante Demag 5 t", tipo: 5, empresa: null, local: 1, serie: "DMG-5T-21908", criadoHa: 71, status: "Ativo" },
  { codigo: "TR-060", nome: "Trator John Deere 6110J", tipo: 6, empresa: 1, local: 2, serie: "JD-6110J-44520", criadoHa: 340, status: "Ativo" },
  { codigo: "TR-061", nome: "Trator Massey Ferguson 4292", tipo: 6, empresa: 1, local: 2, serie: "MF-4292-10073", criadoHa: 28, status: "Ativo" },
  { codigo: "TR-062", nome: "Trator New Holland TL75E", tipo: 6, empresa: 1, local: 2, criadoHa: 19, status: "Ativo" },
];

// Usuários extras da conta, para a tela de Usuários ter mais de uma linha e
// para que o "Responsável" dos planos e das emissões não seja sempre a mesma
// pessoa. `perfil` é um dos 4 perfis padrão (src/server/perfis-padrao.ts), e
// um deles fica `ConvitePendente` e outro `Inativo` de propósito: são os dois
// casos que a regra de responsável precisa recusar na escolha e preservar na
// edição de um registro antigo.
const USUARIOS = [
  { nome: "Rogério Paiva", conta: "rogerio", perfil: "Administrador", status: "Ativo" },
  { nome: "Simone Araújo", conta: "simone", perfil: "Inspetor", status: "Ativo" },
  { nome: "Tadeu Lemos", conta: "tadeu", perfil: "Técnico de manutenção", status: "Ativo" },
  { nome: "Úrsula Dias", conta: "ursula", perfil: "Somente leitura", status: "Ativo" },
  { nome: "Valter Hungria", conta: "valter", perfil: "Técnico de manutenção", status: "ConvitePendente" },
  { nome: "Wanda Ferraz", conta: "wanda", perfil: "Somente leitura", status: "Inativo" },
].map((u) => ({ ...u, email: `${u.conta}@${DOMINIO}` }));

/// Identidade administradora que nasce com a conta, quando este script precisa
/// criá-la. Separada das de cima porque o provisionamento já a cria junto da
/// conta — é a MESMA via que a criação de conta pelo operador de plataforma
/// usa (Story 6.7), e não uma segunda forma de nascer.
const ADMIN_DA_CONTA = {
  nome: "Rogério Paiva",
  email: `rogerio@${DOMINIO}`,
};

// ---------------------------------------------------------------------------

type Ctx = {
  contaId: string;
  empresas: string[];
  locais: string[];
  tipos: string[];
  ativos: { id: string; codigo: string }[];
  cargos: string[];
  funcoes: string[];
  pessoas: string[];
  itens: string[];
  usuarios: string[];
};

async function popularUsuarios(contaId: string, senha: string): Promise<string[]> {
  const encontrados = await prisma.perfilAcesso.findMany({
    where: { contaId },
    select: { id: true, nome: true },
  });
  const perfis = new Map(encontrados.map((p) => [p.nome, p.id]));
  const hash = await hashPassword(senha);
  const ids: string[] = [];

  for (const dados of USUARIOS) {
    const perfilAcessoId = perfis.get(dados.perfil);
    if (!perfilAcessoId) {
      throw new Error(
        `[demo] Perfil "${dados.perfil}" não existe nesta conta. Perfis encontrados: ` +
          `${[...perfis.keys()].join(", ")}.`,
      );
    }

    const usuario = await prisma.usuario.upsert({
      where: { email: dados.email },
      create: {
        nome: dados.nome,
        email: dados.email,
        status: dados.status as Prisma.UsuarioCreateInput["status"],
      },
      update: { status: dados.status as Prisma.UsuarioCreateInput["status"] },
      select: { id: true },
    });

    await prisma.vinculoConta.upsert({
      where: { usuarioId_contaId: { usuarioId: usuario.id, contaId } },
      create: {
        usuarioId: usuario.id,
        contaId,
        perfilAcessoId,
        nome: dados.nome,
        // O vínculo acompanha o status da identidade: um convite pendente com
        // vínculo Ativo não seria mais um convite pendente.
        status: dados.status === "Ativo" ? "Ativo" : "ConvitePendente",
      },
      update: { perfilAcessoId, nome: dados.nome },
      select: { id: true },
    });

    // Senha só para quem está apto a entrar. Dar credencial ao convite
    // pendente apagaria justamente o caso que ele existe para mostrar.
    if (dados.status === "Ativo") {
      await prisma.account.upsert({
        where: {
          providerId_accountId: { providerId: "credential", accountId: usuario.id },
        },
        create: {
          userId: usuario.id,
          providerId: "credential",
          accountId: usuario.id,
          password: hash,
        },
        update: { password: hash },
      });
    }

    ids.push(usuario.id);
  }

  return ids;
}

async function popularCadastrosBase(contaId: string, senha: string): Promise<Ctx> {
  const empresas: string[] = [];
  for (const e of EMPRESAS) {
    const linha = await prisma.empresa.upsert({
      where: { contaId_razaoSocial: { contaId, razaoSocial: e.razaoSocial } },
      create: { contaId, ...e },
      update: { nomeFantasia: e.nomeFantasia },
      select: { id: true },
    });
    empresas.push(linha.id);
  }

  const locais: string[] = [];
  for (const [indice, l] of LOCAIS.entries()) {
    const linha = await prisma.local.upsert({
      where: { contaId_nome: { contaId, nome: l.nome } },
      create: {
        contaId,
        ...l,
        // Polígono em dois dos locais: a tela precisa mostrar tanto o caso com
        // área desenhada quanto o sem.
        areaPoligono:
          indice < 2
            ? [
                { x: 120, y: 60 },
                { x: 430, y: 72 },
                { x: 455, y: 215 },
                { x: 140, y: 230 },
              ]
            : undefined,
        status: indice === 3 ? "Inativo" : "Ativo",
      },
      update: { endereco: l.endereco },
      select: { id: true },
    });
    locais.push(linha.id);
  }

  const tipos: string[] = [];
  for (const t of TIPOS) {
    const linha = await prisma.tipoAtivo.upsert({
      where: { contaId_nome: { contaId, nome: t.nome } },
      create: { contaId, ...t },
      update: { descricao: t.descricao },
      select: { id: true },
    });
    tipos.push(linha.id);
  }

  const cargos: string[] = [];
  for (const [indice, descricao] of CARGOS.entries()) {
    const linha = await prisma.cargo.upsert({
      where: { contaId_descricao: { contaId, descricao } },
      create: { contaId, descricao, status: indice === 6 ? "Inativo" : "Ativo" },
      update: {},
      select: { id: true },
    });
    cargos.push(linha.id);
  }

  const funcoes: string[] = [];
  for (const [indice, descricao] of FUNCOES.entries()) {
    const linha = await prisma.funcao.upsert({
      where: { contaId_descricao: { contaId, descricao } },
      create: { contaId, descricao, status: indice === 6 ? "Inativo" : "Ativo" },
      update: {},
      select: { id: true },
    });
    funcoes.push(linha.id);
  }

  const itens: string[] = [];
  for (const [indice, i] of ITENS.entries()) {
    const linha = await prisma.itemRevisional.upsert({
      where: { contaId_nome: { contaId, nome: i.nome } },
      create: {
        contaId,
        ...i,
        descricao: `${i.categoria} — ${i.grupo}.`,
        // Um item arquivado: é o que mostra que o seletor não oferece
        // arquivado, mas um plano que já o tinha continua editável.
        status: indice === ITENS.length - 1 ? "Arquivado" : "Ativo",
      },
      update: {},
      select: { id: true },
    });
    itens.push(linha.id);
  }

  const ativos: Ctx["ativos"] = [];
  for (const a of ATIVOS) {
    const linha = await prisma.ativo.upsert({
      where: { contaId_codigo: { contaId, codigo: a.codigo } },
      create: {
        contaId,
        codigo: a.codigo,
        nome: a.nome,
        tipoAtivoId: tipos[a.tipo],
        empresaId: a.empresa === null ? null : empresas[a.empresa],
        localizacao: LOCAIS[a.local].nome,
        numeroSerie: a.serie ?? null,
        status: a.status as Prisma.AtivoCreateInput["status"],
        // Data de entrada forçada: é dela que sai a próxima revisão de todo
        // plano que cobre este ativo, então é ela que torna os estados da tela
        // de Planos previsíveis em vez de todos iguais.
        createdAt: diasAtras(a.criadoHa),
      },
      update: {
        nome: a.nome,
        status: a.status as Prisma.AtivoCreateInput["status"],
        // Também no update: sem isto, reexecutar não corrige a idade de um
        // ativo já gravado, e o estado dos planos ficaria preso ao valor da
        // primeira execução.
        createdAt: diasAtras(a.criadoHa),
      },
      select: { id: true },
    });
    ativos.push({ id: linha.id, codigo: a.codigo });
  }

  const pessoas: string[] = [];
  for (const p of PESSOAS) {
    // Pessoa não tem chave única no schema, então a idempotência é por
    // (contaId, cpf) procurado à mão.
    const existente = await prisma.pessoa.findFirst({
      where: { contaId, cpf: p.cpf },
      select: { id: true },
    });
    if (existente) {
      pessoas.push(existente.id);
      continue;
    }
    const linha = await prisma.pessoa.create({
      data: {
        contaId,
        nome: p.nome,
        cpf: p.cpf,
        cargoId: cargos[p.cargo],
        funcaoId: funcoes[p.funcao],
      },
      select: { id: true },
    });
    pessoas.push(linha.id);
  }

  const usuarios = await popularUsuarios(contaId, senha);

  return { contaId, empresas, locais, tipos, ativos, cargos, funcoes, pessoas, itens, usuarios };
}

// Planos nos TRÊS vínculos que o XOR permite: por ativo, por tipo e por
// empresa. Sem os três, a coluna "Vinculado a" mostra sempre a mesma coisa e a
// derivação do plano a partir do ativo (AD-32) nunca precisa escolher entre
// candidatos concorrentes.
const PLANOS = [
  { nome: "Preventiva 90 dias — frota basculante", vinculo: "tipo", alvo: 0, itens: [0, 1, 2, 4], responsavel: 1 },
  { nome: "Preventiva anual — frota basculante", vinculo: "tipo", alvo: 0, itens: [3, 9, 11], responsavel: 1 },
  { nome: "Preventiva — escavadeiras", vinculo: "tipo", alvo: 1, itens: [0, 6, 8], responsavel: 2 },
  { nome: "Preventiva — empilhadeiras", vinculo: "tipo", alvo: 2, itens: [0, 10, 14], responsavel: 2 },
  { nome: "Preventiva — compressores", vinculo: "tipo", alvo: 3, itens: [1, 14, 10], responsavel: 0 },
  { nome: "Preventiva — geradores", vinculo: "tipo", alvo: 4, itens: [0, 2, 10], responsavel: 0 },
  { nome: "Inspeção de carga — pontes rolantes", vinculo: "tipo", alvo: 5, itens: [13, 10], responsavel: 1 },
  { nome: "Plano dedicado — CB-001 Volvo FMX", vinculo: "ativo", alvo: 0, itens: [0, 4, 5, 6], responsavel: 2 },
  { nome: "Plano dedicado — EH-010 Caterpillar", vinculo: "ativo", alvo: 6, itens: [6, 7, 8], responsavel: 2 },
  { nome: "Contrato Campo Alto — equipamentos locados", vinculo: "empresa", alvo: 1, itens: [0, 8, 10], responsavel: 1 },
  { nome: "Contrato Metal São Jorge", vinculo: "empresa", alvo: 2, itens: [1, 14], responsavel: 0 },
  // Arquivado: a tela precisa ter o que mostrar no filtro de arquivados, e um
  // plano arquivado não pode aparecer como candidato na emissão.
  { nome: "Preventiva 2024 (descontinuada)", vinculo: "tipo", alvo: 6, itens: [0, 1], responsavel: 0, arquivado: true },
  // Itens só de km/horas: nenhum tem controle de dias, então a próxima revisão
  // é nula e o plano cai no estado que hoje é indistinguível de "No prazo" —
  // exatamente o caso que está em decisão.
  { nome: "Controle por medição — tratores", vinculo: "tipo", alvo: 6, itens: [12, 15], responsavel: 1 },
] as const;

type PlanoCriado = { id: string; itens: string[] };

async function popularPlanos(ctx: Ctx): Promise<PlanoCriado[]> {
  const criados: PlanoCriado[] = [];

  for (const p of PLANOS) {
    const plano = await prisma.planoRevisional.upsert({
      where: { contaId_nome: { contaId: ctx.contaId, nome: p.nome } },
      create: {
        contaId: ctx.contaId,
        nome: p.nome,
        ativoId: p.vinculo === "ativo" ? ctx.ativos[p.alvo].id : null,
        tipoAtivoId: p.vinculo === "tipo" ? ctx.tipos[p.alvo] : null,
        empresaId: p.vinculo === "empresa" ? ctx.empresas[p.alvo] : null,
        responsavelId: ctx.usuarios[p.responsavel],
        status: "arquivado" in p && p.arquivado ? "Arquivado" : "Ativo",
      },
      update: { responsavelId: ctx.usuarios[p.responsavel] },
      select: { id: true },
    });

    for (const [ordem, indiceItem] of p.itens.entries()) {
      const override =
        ordem === 0 && ITENS[indiceItem].diasPadrao !== undefined ? 75 : null;
      await prisma.planoItemRevisional.upsert({
        where: {
          planoId_itemRevisionalId: {
            planoId: plano.id,
            itemRevisionalId: ctx.itens[indiceItem],
          },
        },
        create: {
          planoId: plano.id,
          itemRevisionalId: ctx.itens[indiceItem],
          // Um override de dias no primeiro item de cada plano: sem nenhum, a
          // coluna de valor sobrescrito fica vazia em toda a tela e a regra
          // `override ?? padrão` nunca é exercitada pelo lado do override.
          //
          // Só num item que JÁ tem controle de dias. Sobrescrever os dias de um
          // item que só controla km ou horas daria a ele um controle que o
          // catálogo não lhe deu — e apagaria justamente o plano "sem controle
          // de dias", que existe aqui para mostrar o estado ambíguo.
          diasOverride: override,
        },
        // `update` repete o override em vez de ser `{}`: com um update vazio,
        // uma correção no catálogo (como a de não sobrescrever dias de um
        // item que só mede km) nunca alcançaria as linhas já gravadas, e o
        // banco de quem rodou a versão antiga ficaria com o valor errado para
        // sempre — exatamente o que aconteceu no banco local em 05-11-2026.
        update: { diasOverride: override },
      });
    }

    criados.push({ id: plano.id, itens: p.itens.map((i) => ctx.itens[i]) });
  }

  return criados;
}

// Emissões. `ativo` é índice em ATIVOS e `plano` em PLANOS — e o par é
// coerente de propósito (o plano de fato cobre aquele ativo), porque é assim
// que a tela deriva o plano a partir do ativo escolhido. `executados` e
// `servicos` indexam os itens DAQUELE plano, não o catálogo.
const EMISSOES = [
  { ativo: 0, plano: 7, status: "Emitido", setor: "Manutencao", emitidaHa: 240, resp: 2, executados: [0, 1, 2, 3], servicos: [[0, 0], [4, 1]] },
  { ativo: 0, plano: 0, status: "Emitido", setor: "Manutencao", emitidaHa: 150, resp: 1, executados: [0, 1], servicos: [[0, 0], [10, 1]] },
  { ativo: 1, plano: 0, status: "Emitido", setor: "Manutencao", emitidaHa: 132, resp: 1, executados: [0, 1, 2], servicos: [[4, 0], [0, 1]] },
  { ativo: 2, plano: 0, status: "Emitido", setor: "Logistica", emitidaHa: 96, resp: 2, executados: [0, 3], servicos: [[0, 0]] },
  { ativo: 6, plano: 8, status: "Emitido", setor: "Manutencao", emitidaHa: 88, resp: 2, executados: [0, 1, 2], servicos: [[1, 0], [7, 1], [4, 2]] },
  { ativo: 10, plano: 3, status: "Emitido", setor: "Producao", emitidaHa: 74, resp: 0, executados: [0, 1, 2], servicos: [[5, 0], [8, 1]] },
  { ativo: 14, plano: 4, status: "Emitido", setor: "Manutencao", emitidaHa: 61, resp: 0, executados: [0, 1], servicos: [[1, 0], [7, 1]] },
  { ativo: 17, plano: 5, status: "Emitido", setor: "Administrativo", emitidaHa: 52, resp: 0, executados: [0, 2], servicos: [[1, 0]] },
  { ativo: 20, plano: 6, status: "Emitido", setor: "SegurancaDoTrabalho", emitidaHa: 45, resp: 1, executados: [0, 1], servicos: [[3, 0], [9, 1]] },
  { ativo: 22, plano: 9, status: "Emitido", setor: "Manutencao", emitidaHa: 38, resp: 1, executados: [0, 1, 2], servicos: [[0, 0], [6, 1]] },
  { ativo: 7, plano: 2, status: "Reprovado", setor: "Manutencao", emitidaHa: 30, resp: 2, executados: [0], servicos: [[1, 0]], motivo: "Medição de horas divergente do apontamento da operação. Refazer a leitura antes de reemitir." },
  { ativo: 11, plano: 3, status: "Reprovado", setor: "Producao", emitidaHa: 24, resp: 0, executados: [0, 1], servicos: [[5, 0]], motivo: "Lançamento de serviço sem a pessoa que executou. Corrigir a aba Serviço e reenviar." },
  { ativo: 3, plano: 0, status: "EmAnalise", setor: "Manutencao", emitidaHa: 12, resp: 1, executados: [0, 1, 2, 3], servicos: [[0, 0], [4, 1], [10, 2]] },
  { ativo: 8, plano: 2, status: "EmAnalise", setor: "Manutencao", emitidaHa: 9, resp: 2, executados: [0, 1], servicos: [[1, 0], [7, 1]] },
  { ativo: 18, plano: 5, status: "EmAnalise", setor: "Logistica", emitidaHa: 6, resp: 0, executados: [0, 1, 2], servicos: [[2, 0], [9, 1]] },
  { ativo: 21, plano: 6, status: "Rascunho", setor: "SegurancaDoTrabalho", emitidaHa: 3, resp: 1, executados: [0], servicos: [[3, 0]] },
  // Rascunho recém-aberto, ainda sem nada preenchido: é o estado em que a tela
  // nasce, e nenhuma das outras emissões o mostra.
  { ativo: 12, plano: 3, status: "Rascunho", setor: "Producao", emitidaHa: 1, resp: 0, executados: [], servicos: [] },
  { ativo: 23, plano: 9, status: "Rascunho", setor: "Manutencao", emitidaHa: 0, resp: 1, executados: [0], servicos: [[0, 0], [6, 1]] },
] as const;

async function popularEmissoes(ctx: Ctx, planos: PlanoCriado[]): Promise<number> {
  const ano = HOJE.getFullYear();
  let criadas = 0;

  // A numeração CONTINUA de onde a conta parou, em vez de começar em 1.
  // Numa conta que já tem emissões — o caso de semear dentro de uma conta de
  // uso real, e não numa recém-criada —, começar em 1 bateria na
  // `@@unique([contaId, ano, seq])` e o script criaria menos emissões do que
  // diz, em silêncio. É a mesma conta que `criarEmissao` faz (count + 1).
  const maiorSeq = await prisma.emissao.aggregate({
    where: { contaId: ctx.contaId, ano },
    _max: { seq: true },
  });
  const base = maiorSeq._max.seq ?? 0;

  for (const [indice, e] of EMISSOES.entries()) {
    const seq = base + indice + 1;
    const plano = planos[e.plano];
    const dataEmissao = diasAtras(e.emitidaHa);

    // Idempotência por (ativo, plano, data), e não por `seq`: com a
    // numeração continuando da conta, o `seq` de uma mesma emissão muda entre
    // execuções, e usá-lo como chave criaria um segundo lote a cada vez.
    //
    // Limite conhecido: as datas derivam de HOJE, então reexecutar NO MESMO
    // DIA não duplica nada (o caso normal), mas reexecutar dias depois gera
    // um lote novo, porque aquelas emissões são, para esta checagem, outras
    // emissões. Quem quiser repetir a semeadura mais tarde apaga o lote
    // anterior primeiro.
    const existente = await prisma.emissao.findFirst({
      where: {
        contaId: ctx.contaId,
        ativoId: ctx.ativos[e.ativo].id,
        planoId: plano.id,
        dataEmissao,
      },
      select: { id: true },
    });
    if (existente) continue;

    const emissao = await prisma.emissao.create({
      data: {
        contaId: ctx.contaId,
        ativoId: ctx.ativos[e.ativo].id,
        planoId: plano.id,
        responsavelId: ctx.usuarios[e.resp],
        dataEmissao,
        setor: e.setor as Prisma.EmissaoCreateInput["setor"],
        dataAgendamento: emDias(7 - e.emitidaHa),
        // Execução só no que saiu do rascunho: um Rascunho com data de fim
        // preenchida descreveria um serviço terminado que ninguém aprovou.
        dataInicio: e.status === "Rascunho" ? null : as(dataEmissao, 7, 30),
        dataFim: e.status === "Emitido" ? as(dataEmissao, 16, 0) : null,
        codigo: `EM-${ano}-${String(seq).padStart(4, "0")}`,
        ano,
        seq,
        status: e.status as Prisma.EmissaoCreateInput["status"],
        motivoReprovacao: "motivo" in e ? e.motivo : null,
      },
      select: { id: true },
    });

    for (const [ordem, indiceDoItemNoPlano] of e.executados.entries()) {
      const itemRevisionalId = plano.itens[indiceDoItemNoPlano];
      if (!itemRevisionalId) continue;
      await prisma.itemExecutadoEmissao.create({
        data: {
          emissaoId: emissao.id,
          itemRevisionalId,
          // O último item de cada emissão não-emitida fica pendente: uma
          // emissão com tudo marcado não mostra a diferença entre executado e
          // não executado.
          executado: e.status === "Emitido" || ordem < e.executados.length - 1,
          valorEsperadoDias: 90,
          medicaoDias: e.status === "Rascunho" ? null : 88 + ordem,
          medicaoKm: ordem % 2 === 0 ? 10200 + ordem * 150 : null,
          medicaoHoras: ordem % 3 === 0 ? 250 + ordem * 12 : null,
          observacao: ordem === 0 ? "Executado conforme procedimento. Sem ocorrências." : null,
        },
      });
    }

    // Serviços: [índice da pessoa, ordem]. Os horários são sequenciais dentro
    // da emissão, de propósito — lançamentos sobrepostos para a MESMA pessoa
    // são erro de validação, e semear um deixaria no banco uma linha que o
    // produto recusaria se alguém a salvasse de novo.
    for (const [indicePessoa, ordem] of e.servicos) {
      const porDuracao = ordem % 2 === 1;
      await prisma.servicoEmissao.create({
        data: {
          emissaoId: emissao.id,
          pessoaId: ctx.pessoas[indicePessoa],
          itemRevisionalId: plano.itens[ordem % plano.itens.length],
          modo: porDuracao ? "Duracao" : "Periodo",
          inicio: porDuracao ? null : as(dataEmissao, 8 + ordem * 3, 0),
          fim: porDuracao ? null : as(dataEmissao, 10 + ordem * 3, 30),
          // Minutos inteiros (AD-28), e valores que não são múltiplos de meia
          // hora — 1:55, 2:40, 3:25 — para a exibição "h:mm" ter o que mostrar.
          duracaoMinutos: porDuracao ? 115 + ordem * 45 : null,
        },
      });
    }

    criadas++;
  }

  return criadas;
}

/// Acha a conta de demonstração, ou a cria.
///
/// A criação passa por `provisionarContaEm` — a MESMA função que a criação de
/// conta pelo operador de plataforma usa, e a mesma que o seed usa (Story
/// 6.7). Montar a conta e os 4 perfis padrão à mão aqui seria uma segunda
/// forma de uma conta nascer, que divergiria da primeira no dia em que a
/// matriz de perfis mudasse.
async function contaDeDemonstracao(): Promise<{ id: string; nome: string; nova: boolean }> {
  const existente = await prisma.conta.findFirst({
    where: { cnpj: CONTA_CNPJ },
    select: { id: true, nome: true },
  });
  if (existente) return { ...existente, nova: false };

  const { provisionarContaEm, OPCOES_DE_TRANSACAO_DE_PROVISIONAMENTO } = await import(
    "../src/server/repositories/provisionamento"
  );

  const { conta } = await prisma.$transaction(
    (tx) =>
      provisionarContaEm(tx, {
        conta: {
          nome: CONTA_NOME,
          cnpj: CONTA_CNPJ,
          planoContratado: "Essencial",
          status: "Ativa",
        },
        administrador: ADMIN_DA_CONTA,
      }),
    OPCOES_DE_TRANSACAO_DE_PROVISIONAMENTO,
  );

  return { id: conta.id, nome: CONTA_NOME, nova: true };
}

async function main() {
  const remoto = bancoRemoto();
  const senha = senhaExigida(remoto);

  if (remoto) {
    console.log(
      "[demo] ATENÇÃO: banco REMOTO, autorizado por DEMO_PERMITIR_BANCO_REMOTO=sim.",
    );
  }

  const conta = await contaDeDemonstracao();
  console.log(
    `[demo] ${conta.nova ? "Conta criada" : "Conta encontrada"}: "${conta.nome}" (${CONTA_CNPJ}).`,
  );

  console.log(`[demo] Populando "${conta.nome}" ...`);
  const ctx = await popularCadastrosBase(conta.id, senha);
  const planos = await popularPlanos(ctx);
  const emissoesNovas = await popularEmissoes(ctx, planos);

  const contagem: [string, number][] = [
    ["empresas", ctx.empresas.length],
    ["locais", ctx.locais.length],
    ["tipos de ativo", ctx.tipos.length],
    ["ativos", ctx.ativos.length],
    ["cargos", ctx.cargos.length],
    ["funções", ctx.funcoes.length],
    ["pessoas", ctx.pessoas.length],
    ["itens revisionais", ctx.itens.length],
    ["planos revisionais", planos.length],
    ["emissões (novas nesta execução)", emissoesNovas],
    ["usuários", ctx.usuarios.length],
  ];

  console.log("[demo] Pronto:");
  for (const [rotulo, total] of contagem) {
    console.log(`[demo]   ${String(total).padStart(3)} ${rotulo}`);
  }
  const maiorEmail = Math.max(...USUARIOS.map((u) => u.email.length));
  console.log("\n[demo] Identidades desta conta (senha igual para todas):");
  for (const u of USUARIOS) {
    const observacao =
      u.status === "ConvitePendente"
        ? "  (convite pendente — NÃO entra)"
        : u.status === "Inativo"
          ? "  (desligada — NÃO entra)"
          : "";
    console.log(`[demo]   ${u.email.padEnd(maiorEmail)}  ${u.perfil}${observacao}`);
  }
  console.log(
    remoto
      ? "\n[demo] A senha é a que veio em DEMO_SENHA — este script não a imprime."
      : `\n[demo] Senha: ${senha}`,
  );
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
