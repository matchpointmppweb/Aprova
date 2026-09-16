// Núcleo transacional de provisionamento (Story 6.7).
//
// Diferente dos demais arquivos de `repositories/`, este NÃO importa
// `./db` nem `server-only`: toda função aqui recebe o executor
// (`Prisma.TransactionClient`) do chamador. São dois os motivos, e os dois são
// a razão do módulo existir:
//
//   1. O Prisma não tem transação aninhada. O provisionamento de uma conta
//      precisa gravar conta + perfis + vínculo do primeiro Administrador numa
//      transação só (AD-9), e o convite da Story 6.6 abria a própria. Extraído
//      o CORPO do convite para cá, `criarUsuarioConvidado` continua abrindo a
//      dele e o provisionamento reusa o mesmo código dentro da sua.
//   2. `prisma/seed.ts` roda fora do runtime do Next, com o próprio
//      PrismaClient, e precisa da MESMA função transacional — o seed nunca foi
//      transacional, e é o que esta story conserta junto. Um `import
//      "server-only"` aqui o quebraria.
//
// O acesso ao Prisma Client continua confinado a `repositories/` (AD-1): quem
// chama estas funções são `conta.ts`, `usuario.ts` e o seed, nunca uma Server
// Action ou componente.
// `Prisma` entra como VALOR para reconhecer os P2002 de corrida — o mesmo
// tratamento que o convite avulso sempre teve.
import { Prisma } from "@prisma/client";
import type { PlanoContratado, StatusConta } from "@prisma/client";

import {
  NOME_ADMINISTRADOR,
  PERFIS_PADRAO,
  permissoesDoPerfil,
  // Import RELATIVO de propósito: o alias `@/` depende do tsconfig, e este
  // módulo também é carregado pelo `tsx` do seed, fora do resolver do Next.
} from "../perfis-padrao";

// `identidadeNova` diz se a IDENTIDADE (linha em `usuarios`) nasceu nesta
// chamada — distinto de `enviarDefinicaoDeSenha`, que é verdadeiro também para
// quem já tinha identidade e nunca definiu senha. Só o seed olha para ele, e por
// um motivo de segurança: o bootstrap se recusa a reaproveitar uma identidade
// que já é de alguém.
export type ResultadoConvite =
  | {
      resultado: "convidado";
      enviarDefinicaoDeSenha: boolean;
      identidadeNova: boolean;
    }
  | { resultado: "ja-tem-acesso" };

export type DadosConvite = {
  nome: string;
  email: string;
  perfilAcessoId: string;
};

// Corpo do convite da Story 6.6 — ver o cabeçalho de `criarUsuarioConvidado`
// (usuario.ts) para as quatro ramificações e para por que
// `enviarDefinicaoDeSenha` é decidido por AUSÊNCIA DE CREDENCIAL e não por
// "identidade nova". Roda inteiro dentro da transação que o chamador abriu: a
// leitura que escolhe o ramo e a escrita que o executa precisam do mesmo
// instante.
export async function convidarEm(
  tx: Prisma.TransactionClient,
  contaId: string,
  dados: DadosConvite,
): Promise<ResultadoConvite> {
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
    return {
      resultado: "convidado",
      enviarDefinicaoDeSenha: true,
      identidadeNova: true,
    };
  }

  const vinculo = await tx.vinculoConta.findUnique({
    where: { usuarioId_contaId: { usuarioId: identidade.id, contaId } },
    select: { id: true, status: true },
  });

  if (vinculo && vinculo.status !== "Inativo") {
    return { resultado: "ja-tem-acesso" };
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
    identidadeNova: false,
  };
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
export function eConstraintDoVinculo(
  erro: Prisma.PrismaClientKnownRequestError,
): boolean {
  const alvo = alvoDaConstraint(erro);
  return (
    (alvo.includes("usuarioId") && alvo.includes("contaId")) ||
    alvo.includes("vinculos_de_conta_usuarioId_contaId_key")
  );
}

// Unique global de `usuarios.email` (Story 6.3).
export function eConstraintDeEmail(
  erro: Prisma.PrismaClientKnownRequestError,
): boolean {
  const alvo = alvoDaConstraint(erro);
  return alvo.includes("email") || alvo.includes("usuarios_email_key");
}

// Tratamento de corrida do convite, COMPARTILHADO entre o convite avulso
// (criarUsuarioConvidado) e o provisionamento de conta nova (criarConta). A
// transação interativa do Prisma roda em Read Committed, então dois convites
// simultâneos para o mesmo e-mail podem ambos ler "não existe"; quem garante a
// unicidade são as CONSTRAINTS, e os dois P2002 possíveis têm desfechos
// diferentes:
//
//   - unique de `usuarios.email`: o outro caminho criou a identidade primeiro.
//     Recusar puniria um operador/administrador inocente — que teria de
//     redigitar o formulário inteiro — e não criaria vínculo nenhum. Reexecutar
//     UMA vez resolve: a identidade agora existe e o convite cai no ramo de
//     vínculo novo. Uma única retentativa, e não um laço: um segundo P2002 de
//     e-mail não é mais corrida, é defeito, e sobe.
//   - unique do vínculo: quem chama decide o que isso significa (`aoColidir`),
//     porque o desfecho correto difere entre convidar para uma conta existente
//     e provisionar uma conta que acabou de nascer.
//
// `executar` precisa ser reexecutável do zero — as duas chamadas abrem a
// transação por dentro, então a primeira já foi inteiramente desfeita quando a
// segunda começa.
export async function comRegrasDeCorrida<T>(
  executar: () => Promise<T>,
  aoColidirVinculo: () => T,
): Promise<T> {
  try {
    return await executar();
  } catch (erro) {
    if (
      !(erro instanceof Prisma.PrismaClientKnownRequestError) ||
      erro.code !== "P2002"
    ) {
      throw erro;
    }

    if (eConstraintDoVinculo(erro)) {
      return aoColidirVinculo();
    }

    if (eConstraintDeEmail(erro)) {
      return executar();
    }

    throw erro;
  }
}

// A janela padrão do Prisma para uma transação interativa é 5s (com 2s de
// espera por conexão). O provisionamento escreve ~60 linhas — conta, 4 perfis,
// 52 permissões, identidade e vínculo — e roda contra Neon serverless (que pode
// estar suspenso) ou, no seed, contra um banco frio. Estourar o padrão vira
// P2028, que chega ao operador como erro genérico "tente novamente" depois de
// ele ter preenchido seis campos. Os valores são explícitos por isso, e são os
// mesmos nos dois chamadores (criarConta e prisma/seed.ts).
export const OPCOES_DE_TRANSACAO_DE_PROVISIONAMENTO = {
  maxWait: 10_000,
  timeout: 30_000,
} as const;

// Só acontece se o vínculo do primeiro Administrador já existir numa conta que
// acabou de ser criada nesta mesma transação — estado impossível. Sobe como
// erro para abortar a transação inteira em vez de deixar passar uma conta
// provisionada sem administrador (Never da story).
export class ProvisionamentoInconsistenteError extends Error {}

export type DadosDaConta = {
  nome: string;
  cnpj: string;
  planoContratado: PlanoContratado;
  status: StatusConta;
};

export type ResultadoProvisionamento = {
  conta: { id: string; nome: string };
  perfis: { id: string; nome: string }[];
  enviarDefinicaoDeSenha: boolean;
  // A identidade do administrador nasceu agora, ou o e-mail já pertencia a
  // alguém na plataforma e ganhou só o vínculo novo (regra da Story 6.6).
  identidadeNova: boolean;
};

// Provisionamento COMPLETO de uma conta-cliente, dentro da transação do
// chamador (AD-9): a conta, os quatro perfis de acesso padrão — cada um com
// uma linha de permissão por módulo configurável — e o vínculo do primeiro
// Administrador. Ou tudo, ou nada: qualquer falha no meio (CNPJ duplicado,
// e-mail em corrida, queda) desfaz o conjunto inteiro, e nunca nasce conta sem
// perfis nem conta sem administrador.
//
// O que NÃO está aqui é o envio do e-mail de definição de senha: ele é efeito
// externo e não pode participar da transação. A função devolve
// `enviarDefinicaoDeSenha` para o chamador disparar DEPOIS do commit — uma
// falha no envio deixa a conta provisionada e utilizável, e o convite pode ser
// refeito pelo fluxo normal (I/O Matrix).
export async function provisionarContaEm(
  tx: Prisma.TransactionClient,
  dados: {
    conta: DadosDaConta;
    administrador: { nome: string; email: string };
  },
): Promise<ResultadoProvisionamento> {
  // Primeiro a conta: é a escrita que falha por CNPJ duplicado, e falhar aqui
  // evita todo o resto.
  const conta = await tx.conta.create({
    data: dados.conta,
    select: { id: true, nome: true },
  });

  // Perfil + suas permissões nascem juntos, no mesmo nested create — mesmo
  // padrão de criarPerfilAcesso (perfil-acesso.ts).
  const perfisCriados = await Promise.all(
    PERFIS_PADRAO.map((perfil) =>
      tx.perfilAcesso.create({
        data: {
          contaId: conta.id,
          nome: perfil.nome,
          descricao: perfil.descricao,
          permissoes: { create: permissoesDoPerfil(perfil) },
        },
        select: { id: true, nome: true },
      }),
    ),
  );

  const perfilAdministrador = perfisCriados.find(
    (perfil) => perfil.nome === NOME_ADMINISTRADOR,
  );
  if (!perfilAdministrador) {
    throw new ProvisionamentoInconsistenteError(
      "A matriz de perfis padrão não contém o perfil Administrador.",
    );
  }

  // Reusa integralmente as regras do convite da Story 6.6: e-mail que já tem
  // identidade na plataforma ganha só o vínculo novo, sem tocar na senha nem
  // renomear a identidade.
  const convite = await convidarEm(tx, conta.id, {
    nome: dados.administrador.nome,
    email: dados.administrador.email,
    perfilAcessoId: perfilAdministrador.id,
  });

  if (convite.resultado === "ja-tem-acesso") {
    throw new ProvisionamentoInconsistenteError(
      "Vínculo preexistente numa conta recém-criada.",
    );
  }

  return {
    conta,
    perfis: perfisCriados,
    enviarDefinicaoDeSenha: convite.enviarDefinicaoDeSenha,
    identidadeNova: convite.identidadeNova,
  };
}
