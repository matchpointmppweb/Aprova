import "server-only";

import type { Prisma, StatusUsuario } from "@prisma/client";

import { prisma } from "./db";

// Permite que chamadores (Server Actions) passem um `tx` de
// prisma.$transaction em vez do client global — usado pela guarda de
// "último Administrador" em editarUsuarioAction, que precisa ler a contagem
// de admins e escrever a atualização na mesma transação para ser atômica
// contra autoedições concorrentes.
type ExecutorPrisma = typeof prisma | Prisma.TransactionClient;

// Única via de leitura/escrita de Usuario (AD-1) — contaId é sempre
// obrigatório e sempre aplicado ao `where`. contaId chega aqui já lido da
// sessão autenticada pela Server Action/Route Handler chamadora, nunca de
// input do cliente.

export async function buscarUsuarioAutenticado(usuarioId: string, contaId: string) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, contaId },
    include: { perfilAcesso: true, conta: true },
  });
}

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
  const resultado = await db.usuario.updateMany({
    where: { id: usuarioId, contaId },
    data: dados,
  });
  return resultado.count > 0;
}

// Primeiro login de um convidado (I/O Matrix): ConvitePendente -> Ativo.
// Só promove quem ainda está ConvitePendente — chamar de novo para um
// usuário já Ativo é um no-op seguro (count 0).
export async function ativarUsuarioConvidado(usuarioId: string, contaId: string) {
  return prisma.usuario.updateMany({
    where: { id: usuarioId, contaId, status: "ConvitePendente" },
    data: { status: "Ativo" },
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
