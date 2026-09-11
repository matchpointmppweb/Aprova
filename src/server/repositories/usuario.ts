import "server-only";

import { prisma } from "./db";

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
