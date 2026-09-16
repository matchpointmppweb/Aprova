import "server-only";

import type { Prisma, StatusUsuario } from "@prisma/client";

import { prisma } from "./db";

// Permite que chamadores (Server Actions) passem um `tx` de
// prisma.$transaction em vez do client global — usado pela guarda de
// "último Administrador" em editarUsuarioAction, que precisa ler a contagem
// de admins e escrever a atualização na mesma transação para ser atômica
// contra autoedições concorrentes.
type ExecutorPrisma = typeof prisma | Prisma.TransactionClient;

// Dual-write da Story 6.1 (fase expand): toda escrita que afete conta, perfil
// ou status de um Usuario espelha o VinculoConta correspondente na MESMA
// transação (AD-9). As colunas de Usuario continuam sendo a fonte de verdade
// — nenhuma leitura daqui passa pelo vínculo (isso é a Story 6.2) — mas sem o
// espelho um usuário convidado/editado entre este deploy e o da 6.2 ficaria
// com vínculo ausente ou defasado.
//
// O Prisma não tem transação aninhada: quando o chamador já passou um `tx`
// (editarUsuarioAction abre a sua, Serializable, para a guarda de último
// Administrador), reutilizamos esse tx; só quando o executor é um client
// capaz de abrir transação é que abrimos uma nossa. A discriminação é por
// capacidade, não por identidade de referência (`db === prisma`): qualquer
// outro PrismaClient legítimo também precisa do ramo transacional, e
// Prisma.TransactionClient é justamente o tipo que não expõe `$transaction`.
function emTransacao<T>(
  db: ExecutorPrisma,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ("$transaction" in db) {
    return db.$transaction(fn);
  }
  return fn(db);
}

// Única via de leitura/escrita de Usuario (AD-1) — contaId é sempre
// obrigatório e sempre aplicado ao `where`. contaId chega aqui já lido da
// sessão autenticada pela Server Action/Route Handler chamadora, nunca de
// input do cliente.

// `buscarUsuarioAutenticado(usuarioId, contaId)` vivia aqui e era a leitura
// que resolvia a identidade autenticada pelas colunas `Usuario.contaId`/
// `Usuario.perfilAcessoId`. A Story 6.2 a substituiu por
// `resolverUsuarioAutenticadoPeloVinculo` em
// src/server/repositories/vinculo-conta.ts, que devolve a mesma forma
// resolvida pelo VinculoConta. As leituras abaixo continuam escopadas por
// `Usuario.contaId` nesta story (o contaId já chega resolvido pelo vínculo),
// e o dual-write da 6.1 segue intocado — remover as colunas é a Story 6.3.

export async function registrarUltimoAcesso(usuarioId: string, contaId: string) {
  return prisma.usuario.updateMany({
    where: { id: usuarioId, contaId },
    data: { ultimoAcesso: new Date() },
  });
}

// Listagem da tela Usuários (Story 1.2) — só usuários da própria conta.
export async function listarUsuarios(contaId: string) {
  return prisma.usuario.findMany({
    where: { contaId },
    include: { perfilAcesso: { select: { id: true, nome: true } } },
    orderBy: { nome: "asc" },
  });
}

// Convite: cria o Usuario com status ConvitePendente e nenhuma linha em
// Account — a senha só existe depois que o convidado passa pelo mesmo fluxo
// de definição de senha do Better Auth (auth.api.requestPasswordReset), em
// src/server/actions/usuario.ts.
export async function criarUsuarioConvidado(
  contaId: string,
  dados: { nome: string; email: string; perfilAcessoId: string },
) {
  return prisma.usuario.create({
    data: {
      nome: dados.nome,
      email: dados.email,
      contaId,
      perfilAcessoId: dados.perfilAcessoId,
      status: "ConvitePendente",
      // Dual-write (Story 6.1): usuário e vínculo nascem juntos no mesmo
      // nested create — atômico por natureza, sem $transaction explícito
      // (mesmo padrão de criarPerfilAcesso/seed.ts). Falha em qualquer lado
      // reverte os dois.
      vinculos: {
        create: {
          contaId,
          perfilAcessoId: dados.perfilAcessoId,
          status: "ConvitePendente",
        },
      },
    },
  });
}

// Edição de nome/e-mail/perfil/status de um usuário existente da conta.
// Retorna false (sem lançar) se o usuário não existir nesta conta, para a
// Server Action decidir como responder sem expor detalhe interno.
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
  // Só conta/perfil/status existem no vínculo — nome e e-mail vivem
  // exclusivamente em Usuario. Uma edição que não toca em nenhum dos dois
  // campos espelhados não precisa de transação nenhuma: segue sendo o mesmo
  // statement único de antes da Story 6.1.
  const espelhaVinculo =
    dados.perfilAcessoId !== undefined || dados.status !== undefined;
  if (!espelhaVinculo) {
    const resultado = await db.usuario.updateMany({
      where: { id: usuarioId, contaId },
      data: dados,
    });
    return resultado.count > 0;
  }

  return emTransacao(db, async (tx) => {
    const resultado = await tx.usuario.updateMany({
      where: { id: usuarioId, contaId },
      data: dados,
    });
    if (resultado.count === 0) {
      // Usuário inexistente nesta conta — nada foi escrito, e o vínculo não
      // pode ser tocado (I/O Matrix: "sem escrever nada").
      return false;
    }

    // Dual-write (Story 6.1) a partir da linha de Usuario já atualizada, lida
    // na mesma transação: ela é a fonte de verdade, inclusive para o campo
    // que `dados` não trouxe.
    const usuario = await tx.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      select: { perfilAcessoId: true, status: true },
    });

    // upsert, e não updateMany: um updateMany afeta 0 linhas sem erro quando
    // o vínculo não existe, e a função ainda retornaria true. O buraco é
    // real — `npm run build` roda `prisma migrate deploy` antes do
    // `next build`, e o deploy antigo (sem dual-write) segue servindo nesse
    // intervalo, podendo criar Usuario sem vínculo depois do backfill. O
    // upsert na chave composta cria a linha ausente, tornando o espelho
    // auto-curativo em vez de silenciosamente ignorado.
    await tx.vinculoConta.upsert({
      where: { usuarioId_contaId: { usuarioId, contaId } },
      create: {
        usuarioId,
        contaId,
        perfilAcessoId: usuario.perfilAcessoId,
        status: usuario.status,
      },
      update: {
        perfilAcessoId: usuario.perfilAcessoId,
        status: usuario.status,
      },
    });

    return true;
  });
}

// Primeiro login de um convidado (I/O Matrix): ConvitePendente -> Ativo.
// Chamar de novo para quem já está Ativo dos dois lados continua sendo
// seguro — é idempotente, só que agora reportando `count: 1` (ver abaixo).
// Story 6.2: a promoção converge os DOIS lados, e não mais só o vínculo de
// quem acabou de sair de ConvitePendente na identidade. Identidade já `Ativo`
// com vínculo ainda `ConvitePendente` é estado real (e rotineiro a partir da
// 6.6) — como a leitura de acesso agora exige `Ativo` no vínculo, deixar essa
// combinação passar significaria login bem-sucedido seguido de expulsão na
// requisição seguinte.
//
// `count` deixou de ser o do updateMany e passou a responder à pergunta que o
// chamador realmente faz: "a pessoa terminou esta chamada podendo entrar?".
// 1 = identidade e vínculo Ativos; 0 = não promovido (usuário inexistente
// nesta conta, ou status que não é ConvitePendente nem Ativo) — o chamador
// trata como falha em vez de redirecionar alguém não promovido.
export async function ativarUsuarioConvidado(usuarioId: string, contaId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.usuario.updateMany({
      where: { id: usuarioId, contaId, status: "ConvitePendente" },
      data: { status: "Ativo" },
    });

    const usuario = await tx.usuario.findFirst({
      where: { id: usuarioId, contaId },
      select: { perfilAcessoId: true, status: true },
    });

    // Nunca ativa o vínculo de quem não está Ativo na identidade (um Inativo
    // não é promovido por uma chamada solta desta função).
    if (!usuario || usuario.status !== "Ativo") {
      return { count: 0 };
    }

    // Dual-write (Story 6.1). upsert pelo mesmo motivo de atualizarUsuario —
    // um vínculo ausente (usuário criado pelo deploy antigo após o backfill) é
    // criado aqui em vez de ignorado; um vínculo já existente converge para
    // Ativo. Repetir a chamada continua sendo seguro: o resultado é o mesmo.
    await tx.vinculoConta.upsert({
      where: { usuarioId_contaId: { usuarioId, contaId } },
      create: {
        usuarioId,
        contaId,
        perfilAcessoId: usuario.perfilAcessoId,
        status: "Ativo",
      },
      update: { status: "Ativo" },
    });

    return { count: 1 };
  });
}

// Sustenta a guarda de "último Administrador" (Decisão confirmada no
// Intent): conta usuários Ativos com o perfil "Administrador" na conta.
export async function contarAdministradoresAtivos(
  contaId: string,
  db: ExecutorPrisma = prisma,
) {
  return db.usuario.count({
    where: {
      contaId,
      status: "Ativo",
      perfilAcesso: { nome: "Administrador" },
    },
  });
}
