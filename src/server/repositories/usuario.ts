import "server-only";

// `Prisma` entra como valor (não só como tipo) para reconhecer o P2025 de uma
// escrita cujo alvo sumiu em paralelo.
import { Prisma } from "@prisma/client";
import type { StatusUsuario } from "@prisma/client";

import { prisma } from "./db";
import { STATUS_COM_ACESSO } from "./vinculo-conta";

// Permite que chamadores (Server Actions) passem um `tx` de
// prisma.$transaction em vez do client global — usado pela guarda de
// "último Administrador" em editarUsuarioAction, que precisa ler a contagem
// de admins e escrever a atualização na mesma transação para ser atômica
// contra autoedições concorrentes.
type ExecutorPrisma = typeof prisma | Prisma.TransactionClient;

// O Prisma não tem transação aninhada: quando o chamador já passou um `tx`,
// reutilizamos esse tx; só quando o executor é um client capaz de abrir
// transação é que abrimos uma nossa. A discriminação é por capacidade, não por
// identidade de referência (`db === prisma`): qualquer outro PrismaClient
// legítimo também precisa do ramo transacional, e Prisma.TransactionClient é
// justamente o tipo que não expõe `$transaction`.
//
// O dual-write da Story 6.1 morreu com as colunas (não há mais dois lados a
// sincronizar), mas o helper continua necessário: uma edição ainda lê o
// vínculo e escreve depois, e as duas metades precisam do mesmo instante.
function emTransacao<T>(
  db: ExecutorPrisma,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ("$transaction" in db) {
    return db.$transaction(fn);
  }
  return fn(db);
}

// Única via de leitura/escrita de Usuario (AD-1).
//
// Story 6.3 (fase contract): `Usuario` não tem mais `contaId` nem
// `perfilAcessoId`. Toda leitura/escrita escopada por conta passa pelo
// VinculoConta — ele é a única fonte de "esta pessoa pertence a esta conta,
// com este perfil e com este status por lá". O dual-write da Story 6.1 e o
// helper `emTransacao` que o sustentava deixaram de existir junto com as
// colunas: não há mais dois lados a sincronizar.
//
// A divisão de responsabilidade entre as duas tabelas é fixa:
//   - identidade (`usuarios`): nome, e-mail (único global), ultimoAcesso,
//     status GLOBAL (concluiu o primeiro acesso / banida da plataforma) e
//     isPlataformaOperador;
//   - vínculo (`vinculos_de_conta`): conta, perfil de acesso e status NAQUELA
//     conta.
//
// `contaId` chega aqui já resolvido pelo vínculo da sessão autenticada
// (src/server/repositories/vinculo-conta.ts), nunca de input do cliente.

// `ultimoAcesso` é da IDENTIDADE, não do vínculo — a pergunta que a coluna
// responde ("quando esta pessoa entrou pela última vez") não tem recorte por
// conta. Por isso a função deixou de receber `contaId`: não havia mais o que
// filtrar, e um parâmetro ignorado se pareceria com um isolamento que não
// acontece.
export async function registrarUltimoAcesso(usuarioId: string) {
  return prisma.usuario.update({
    where: { id: usuarioId },
    data: { ultimoAcesso: new Date() },
  });
}

// Identidade revalidada contra o banco, SEM recorte por conta (Story 6.4,
// AD-13). Existe para o gate do operador de plataforma: aquela área não
// pertence a conta nenhuma, então exigir vínculo/conta ativa ali tirava a área
// de Contas justamente de quem tem mais de um vínculo.
//
// O status GLOBAL continua sendo checado aqui — uma identidade banida da
// plataforma não opera nada, com ou sem vínculo — e é revalidado a cada
// requisição (NFR6): não basta o que o token de sessão carrega.
//
// STATUS_COM_ACESSO é fixo dentro da função, e não parâmetro: o nome promete
// "ativa", e receber a allowlist de fora deixaria alguém passar
// STATUS_COM_LOGIN e fazer uma identidade ConvitePendente cruzar o gate do
// operador de plataforma — o gate mais sensível do sistema. Só existe um
// chamador e só existe um valor correto.
export async function buscarIdentidadeAtiva(usuarioId: string) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, status: { in: [...STATUS_COM_ACESSO] } },
    // Só o que o gate decide e a casca mostra — nada de devolver a linha
    // inteira para uma área que não tem conta nem perfil.
    select: { id: true, nome: true, isPlataformaOperador: true },
  });
}

// Listagem da tela Usuários (Story 1.2) e origem única do seletor de
// responsável de Planos e de Emissão, além da validação
// `vinculoEResponsavelValidos` (AD-25).
//
// A ASSINATURA e a FORMA do retorno são deliberadamente as mesmas de antes da
// Story 6.3 — é isso que mantém app/(dashboard)/{usuarios,planos-revisionais,
// emissao}/page.tsx e src/server/actions/{plano,emissao}.ts intactos. O que
// mudou é a origem: consulta os VÍNCULOS da conta, não mais `Usuario.contaId`.
//
// Duas escolhas explícitas sobre o que sai daqui:
//   - `perfilAcesso` é o do VÍNCULO (o mesmo perfil que can() aplica naquela
//     conta), não um atributo da identidade — que não tem mais perfil nenhum;
//   - `status` é o do VÍNCULO, sobrescrevendo o status global vindo do spread.
//     É o status daquela conta que a tela de Usuários mostra, filtra e edita,
//     e é ele que o FR24 encerra ao remover alguém de uma conta.
//   - `nome` é o do VÍNCULO (Story 6.6) — o nome pelo qual ESTA conta conhece a
//     pessoa. Exibir o da identidade deixaria um administrador descobrir, só
//     convidando um e-mail qualquer, o nome do dono dele (NFR2). A coluna é NOT
//     NULL desde `20260916180000_nome_no_vinculo_obrigatorio`, então não há queda
//     para o nome da identidade — que era justamente o valor vazado.
//
// A ordenação passou para memória junto com a troca da chave: ordenar pela
// coluna antiga (`usuario.nome`) deixaria a tela exibindo um nome e ordenando
// por outro, e o critério de comparação aqui é explícito, o que nenhum `orderBy`
// do Prisma oferece.
//
// NÃO filtra por `status`: a tela de Usuários lista e filtra os três estados
// (Ativo/Convite pendente/Inativo) do lado do cliente, e quem foi desativado
// precisa continuar aparecendo para poder ser reativado. "Vínculo ativo na
// conta" aqui é o vínculo VIGENTE — quem não tem vínculo nenhum com a conta é
// que nunca aparece (NFR2).
export async function listarUsuarios(contaId: string) {
  const vinculos = await prisma.vinculoConta.findMany({
    where: { contaId },
    include: {
      usuario: true,
      perfilAcesso: { select: { id: true, nome: true } },
    },
  });

  return vinculos
    .map((vinculo) => ({
      ...vinculo.usuario,
      nome: vinculo.nome,
      status: vinculo.status,
      perfilAcesso: vinculo.perfilAcesso,
    }))
    // Locale e opções EXPLÍCITOS: sem eles, acentuação e caixa ficariam por
    // conta do ICU do runtime, e a mesma lista poderia sair em ordens
    // diferentes entre a máquina de dev e o servidor. `id` como desempate
    // porque dois homônimos — que esta tela tem todo o direito de ter — sairiam
    // em ordem não determinística entre requisições.
    .sort(
      (a, b) =>
        a.nome.localeCompare(b.nome, "pt-BR", {
          sensitivity: "base",
          numeric: true,
        }) || a.id.localeCompare(b.id),
    );
}

// Convite (Story 6.6): a operação é sobre VÍNCULOS, não sobre cadastros. O
// e-mail é resolvido primeiro e a função ramifica em quatro:
//
//   - sem identidade na plataforma  -> identidade + vínculo, juntos;
//   - identidade em outra conta     -> APENAS o vínculo novo (senha e demais
//                                      vínculos intactos, identidade jamais
//                                      renomeada);
//   - vínculo Inativo nesta conta   -> reativado com o perfil e o nome de
//                                      agora — é o caminho natural de "removi e
//                                      quis de volta", nunca um vínculo
//                                      duplicado;
//   - vínculo Ativo/ConvitePendente -> recusa ("ja-tem-acesso"), o único caso
//                                      que devolve erro de campo.
//
// Os três primeiros são indistinguíveis para o chamador exceto por
// `enviarDefinicaoDeSenha`, que existe por UM motivo só: decidir se o convite de
// definição de senha sai.
//
// O critério é **"esta identidade não tem credencial"**, e NÃO "a identidade
// nasceu agora". A segunda formulação parece equivalente e não é: este próprio
// fluxo produz identidades sem `Account` — nenhum ramo aqui cria credencial, ela
// só nasce quando o convidado percorre o link de definição de senha. Alguém
// convidado para a conta A que nunca aceitou tem identidade e não tem senha;
// convidá-lo para a conta B cairia no ramo "identidade já existe", nenhum e-mail
// sairia, e a pessoa ficaria sem como entrar em lugar nenhum. O mesmo valia para
// a reativação de vínculo inativo. Quem JÁ tem credencial continua não recebendo
// nada — a senha dela vale, e emitir um token de redefinição sobre uma
// credencial que não pertence a esta conta é o que a story proíbe.
//
// A checagem roda DENTRO da transação, junto da leitura que decide o ramo: fora
// dela, a credencial poderia nascer (ou sumir) entre uma coisa e outra e o
// convite decidiria pelo estado errado.
//
// Tudo numa transação (AD-9) para que a leitura que decide o ramo e a escrita
// que o executa formem uma unidade — mas a transação NÃO é o que impede convites
// concorrentes de colidirem: o `$transaction` interativo do Prisma roda no
// isolamento padrão do Postgres (Read Committed), em que dois convites
// simultâneos para o mesmo e-mail podem mesmo ler ambos "não existe". Quem
// garante a unicidade são as CONSTRAINTS, e os dois P2002 possíveis são
// traduzidos no `catch` abaixo, cada um para o desfecho que a story define.
export type ResultadoConvite =
  | { resultado: "convidado"; enviarDefinicaoDeSenha: boolean }
  | { resultado: "ja-tem-acesso" };

export async function criarUsuarioConvidado(
  contaId: string,
  dados: { nome: string; email: string; perfilAcessoId: string },
): Promise<ResultadoConvite> {
  try {
    return await executarConvite(contaId, dados);
  } catch (erro) {
    if (!(erro instanceof Prisma.PrismaClientKnownRequestError) || erro.code !== "P2002") {
      throw erro;
    }

    if (eConstraintDoVinculo(erro)) {
      // Convite concorrente para o mesmo e-mail NESTA conta criou o vínculo
      // entre a leitura e a escrita — mesmo desfecho do ramo normal.
      return { resultado: "ja-tem-acesso" };
    }

    if (eConstraintDeEmail(erro)) {
      // Convite concorrente para o mesmo e-mail NOVO, em duas contas
      // diferentes: o outro criou a identidade primeiro. Recusar com "e-mail
      // indisponível" puniria um administrador inocente e não criaria vínculo
      // nenhum. Reexecutar UMA vez resolve: a identidade agora existe, e o
      // convite vira o ramo de vínculo novo — que é o desfecho correto. Uma
      // única retentativa, e não um laço: um segundo P2002 de e-mail não é mais
      // corrida, é defeito, e sobe.
      return executarConvite(contaId, dados);
    }

    throw erro;
  }
}

async function executarConvite(
  contaId: string,
  dados: { nome: string; email: string; perfilAcessoId: string },
): Promise<ResultadoConvite> {
  return prisma.$transaction(async (tx) => {
      const identidade = await tx.usuario.findUnique({
        where: { email: dados.email },
        select: { id: true },
      });

      if (!identidade) {
        // Nested create: atômico dentro da transação que já abrimos. O `status`
        // da identidade nasce ConvitePendente porque ela ainda não concluiu o
        // primeiro acesso; o do vínculo, porque o convite para ESTA conta ainda
        // não foi aceito. `perfilAcessoId` vive só no vínculo (Story 6.3).
        await tx.usuario.create({
          data: {
            nome: dados.nome,
            email: dados.email,
            status: "ConvitePendente",
            vinculos: {
              create: {
                contaId,
                perfilAcessoId: dados.perfilAcessoId,
                status: "ConvitePendente",
                nome: dados.nome,
              },
            },
          },
        });
        // Identidade recém-criada nunca tem `Account` — o convite de definição
        // de senha é o que vai criá-la.
        return { resultado: "convidado", enviarDefinicaoDeSenha: true } as const;
      }

      const vinculo = await tx.vinculoConta.findUnique({
        where: { usuarioId_contaId: { usuarioId: identidade.id, contaId } },
        select: { id: true, status: true },
      });

      if (vinculo && vinculo.status !== "Inativo") {
        return { resultado: "ja-tem-acesso" } as const;
      }

      if (vinculo) {
        await tx.vinculoConta.update({
          where: { id: vinculo.id },
          data: {
            perfilAcessoId: dados.perfilAcessoId,
            status: "ConvitePendente",
            nome: dados.nome,
          },
        });
      } else {
        await tx.vinculoConta.create({
          data: {
            usuarioId: identidade.id,
            contaId,
            perfilAcessoId: dados.perfilAcessoId,
            status: "ConvitePendente",
            nome: dados.nome,
          },
        });
      }

      // O vínculo reativado/novo nasce ConvitePendente mesmo que a identidade já
      // esteja Ativa: é o estado que a 6.2/6.4 já sabem promover no primeiro
      // acesso a ESTA conta, e é o que a tela de Usuários mostra como "Convite
      // pendente".
      //
      // Identidade sem credencial (convidada antes e nunca aceita) recebe o link
      // de definição de senha também por este ramo — ver o cabeçalho.
      const credenciais = await tx.account.count({
        where: { userId: identidade.id, providerId: "credential" },
      });

      return {
        resultado: "convidado",
        enviarDefinicaoDeSenha: credenciais === 0,
      } as const;
  });
}

// `meta.target` do P2002 vem ora como lista de campos, ora como nome do índice.
function alvoDaConstraint(erro: Prisma.PrismaClientKnownRequestError): string[] {
  const alvo = erro.meta?.target;
  if (Array.isArray(alvo)) return alvo.map(String);
  return typeof alvo === "string" ? [alvo] : [];
}

// Especificamente @@unique([usuarioId, contaId]) de `vinculos_de_conta`. Casar
// `contaId` sozinho seria errado e perigoso: vários outros uniques do schema o
// contêm (`perfis_de_acesso_contaId_nome_key`, `tipos_de_ativo_contaId_nome_key`,
// `ativos_contaId_codigo_key`), e qualquer escrita futura dentro desta transação
// que esbarrasse num deles seria reportada em silêncio como "já tem acesso".
// Exige os DOIS campos, ou o nome exato do índice.
function eConstraintDoVinculo(erro: Prisma.PrismaClientKnownRequestError): boolean {
  const alvo = alvoDaConstraint(erro);
  return (
    (alvo.includes("usuarioId") && alvo.includes("contaId")) ||
    alvo.includes("vinculos_de_conta_usuarioId_contaId_key")
  );
}

// Unique global de `usuarios.email` (Story 6.3).
function eConstraintDeEmail(erro: Prisma.PrismaClientKnownRequestError): boolean {
  const alvo = alvoDaConstraint(erro);
  return alvo.includes("email") || alvo.includes("usuarios_email_key");
}

// Edição pela tela de Usuários. Os campos se dividem entre as duas tabelas:
// `email` é da identidade; `nome`, `perfilAcessoId` e `status` são do vínculo
// daquela conta.
//
// Story 6.6: `nome` MUDOU DE LADO. Era campo de identidade (com a trava
// cross-tenant abaixo), e agora é sempre do vínculo — a mesma coluna que o
// convite grava e que a listagem exibe. Assim a conta rotula a pessoa como a
// conhece sem nunca renomear a identidade dela, que é o que a 6.3 proíbe e o
// que faria a listagem virar oráculo de nomes alheios (NFR2).
//
// Retorna false (sem lançar) se a pessoa não tiver vínculo com esta conta,
// para a Server Action decidir como responder sem expor detalhe interno — e,
// nesse caso, NADA é escrito: o vínculo é o que dá o escopo multi-tenant desta
// operação (AD-1), no lugar do antigo `where: { id, contaId }`.
//
// **O e-mail é recusado para quem tem mais de um vínculo.** A identidade
// atravessa contas: escrever `email` a partir da conta A mudaria o LOGIN de
// alguém que também pertence à conta B e que, somado ao fluxo de definição de
// senha, entregaria a conta dessa pessoa ao administrador de A. A recusa é
// fail-closed: multivínculo => só os campos do vínculo (`nome`,
// `perfilAcessoId`, `status`, sempre escopados a ESTA conta) passam; uma
// tentativa real de trocar o `email` devolve false, sem escrever nada. Reenviar
// o mesmo valor não é tentativa de alteração — o formulário sempre manda os
// quatro campos — e segue adiante.
//
// Leitura e escrita rodam sempre na MESMA transação: o chamador
// (editarUsuarioAction) abre uma Serializable para a guarda de último
// Administrador e passa o `tx`; quando ninguém passa, abrimos uma aqui — sem
// isso, a checagem do vínculo e a escrita seriam dois instantes distintos.
export async function atualizarUsuario(
  contaId: string,
  usuarioId: string,
  dados: Partial<{
    nome: string;
    email: string;
    perfilAcessoId: string;
    status: StatusUsuario;
  }>,
  db: ExecutorPrisma = prisma,
) {
  return emTransacao(db, async (tx) => {
    const vinculos = await tx.vinculoConta.findMany({
      where: { usuarioId },
      select: { id: true, contaId: true },
    });
    const vinculo = vinculos.find((atual) => atual.contaId === contaId);
    if (!vinculo) {
      return false;
    }

    const camposDaIdentidade: Prisma.UsuarioUpdateInput = {};
    if (dados.email !== undefined) {
      const identidade = await tx.usuario.findUniqueOrThrow({
        where: { id: usuarioId },
        select: { email: true },
      });

      if (dados.email !== identidade.email && vinculos.length > 1) {
        return false;
      }
      camposDaIdentidade.email = dados.email;
    }

    const camposDoVinculo: Prisma.VinculoContaUpdateWithoutUsuarioInput = {};
    if (dados.nome !== undefined) camposDoVinculo.nome = dados.nome;
    if (dados.perfilAcessoId !== undefined) {
      camposDoVinculo.perfilAcesso = { connect: { id: dados.perfilAcessoId } };
    }
    if (dados.status !== undefined) camposDoVinculo.status = dados.status;

    try {
      await tx.usuario.update({
        where: { id: usuarioId },
        data: {
          ...camposDaIdentidade,
          ...(Object.keys(camposDoVinculo).length > 0
            ? { vinculos: { update: { where: { id: vinculo.id }, data: camposDoVinculo } } }
            : {}),
        },
      });
    } catch (erro) {
      // P2025 = a identidade ou o vínculo sumiu entre a leitura e a escrita
      // (alguém removeu a pessoa da conta em paralelo). É exatamente o caso
      // "usuário sem vínculo nesta conta" — false, e não erro genérico.
      if (
        erro instanceof Prisma.PrismaClientKnownRequestError &&
        erro.code === "P2025"
      ) {
        return false;
      }
      throw erro;
    }

    return true;
  });
}

// Primeiro login de um convidado (I/O Matrix da Story 1.2):
// ConvitePendente -> Ativo. Idempotente — chamar de novo para quem já está
// Ativo dos dois lados repete o mesmo resultado.
//
// A promoção converge os DOIS lados (Story 6.2): a leitura de acesso exige
// `Ativo` na identidade E no vínculo, então deixar um deles para trás
// significaria login bem-sucedido seguido de expulsão na requisição seguinte.
// Identidade já `Ativo` com vínculo ainda `ConvitePendente` é estado real (e
// rotineiro a partir da 6.6, quando uma pessoa já ativa numa conta é convidada
// para outra).
//
// `count` responde à pergunta que o chamador realmente faz: "a pessoa terminou
// esta chamada podendo entrar?". 1 = identidade e vínculo Ativos; 0 = não
// promovida (sem vínculo com esta conta, ou Inativo de algum dos lados — um
// Inativo nunca é promovido por uma chamada solta desta função).

// Aborta a transação de ativarUsuarioConvidado quando a identidade é desativada
// entre a leitura e a escrita — desfaz a promoção parcial do vínculo, sem virar
// erro para o chamador (que recebe { count: 0 } como em qualquer outra recusa).
class PromocaoConcorrenteError extends Error {}
export async function ativarUsuarioConvidado(usuarioId: string, contaId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const vinculo = await tx.vinculoConta.findUnique({
        where: { usuarioId_contaId: { usuarioId, contaId } },
        select: { status: true, usuario: { select: { status: true } } },
      });

      if (!vinculo || vinculo.status === "Inativo" || vinculo.usuario.status === "Inativo") {
        return { count: 0 };
      }

      // Compare-and-set: o `status` continua no WHERE das duas escritas, não
      // só na leitura acima. Sem isso, um administrador que desativasse a
      // pessoa entre a leitura e a escrita teria a desativação revertida em
      // silêncio por um login concorrente.
      const vinculoPromovido = await tx.vinculoConta.updateMany({
        where: { usuarioId, contaId, status: { not: "Inativo" } },
        data: { status: "Ativo" },
      });
      if (vinculoPromovido.count === 0) {
        return { count: 0 };
      }

      const identidadePromovida = await tx.usuario.updateMany({
        where: { id: usuarioId, status: { not: "Inativo" } },
        data: { status: "Ativo" },
      });
      if (identidadePromovida.count === 0) {
        // Identidade banida entre a leitura e esta escrita: o vínculo acabou de
        // ser promovido e não pode ficar assim. Abortar a transação desfaz a
        // promoção — devolver { count: 0 } daqui a deixaria gravada.
        throw new PromocaoConcorrenteError();
      }

      return { count: 1 };
    });
  } catch (erro) {
    if (erro instanceof PromocaoConcorrenteError) {
      return { count: 0 };
    }
    throw erro;
  }
}

// Sustenta a guarda de "último Administrador" (Intent da Story 1.2): conta as
// pessoas que de fato podem administrar ESTA conta agora.
//
// Story 6.3: a contagem é por VÍNCULO — é ele que carrega o perfil de acesso e
// o status por conta. A identidade também precisa estar `Ativo` porque o
// acesso exige `Ativo` nos dois lados; contar alguém banido da plataforma como
// administrador ativo deixaria a conta ficar sem nenhum.
export async function contarAdministradoresAtivos(
  contaId: string,
  db: ExecutorPrisma = prisma,
) {
  return db.vinculoConta.count({
    where: {
      contaId,
      status: "Ativo",
      perfilAcesso: { nome: "Administrador" },
      usuario: { status: "Ativo" },
    },
  });
}
