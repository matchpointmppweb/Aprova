import "server-only";

import type { Modulo } from "@prisma/client";

import { prisma } from "./db";

// Única via de leitura de PerfilAcesso/PermissaoModulo nesta story (AD-1) —
// contaId sempre obrigatório e sempre aplicado ao `where`. CRUD completo de
// Perfil de acesso é escopo da Story 1.3; aqui só o necessário para can()
// (buscarPermissaoDoModulo) e o dropdown de convite/edição de usuário
// (listarPerfisAcesso).

export async function buscarPermissaoDoModulo(
  perfilAcessoId: string,
  contaId: string,
  modulo: Modulo,
) {
  return prisma.permissaoModulo.findFirst({
    where: { modulo, perfilAcesso: { id: perfilAcessoId, contaId } },
  });
}

export async function listarPerfisAcesso(contaId: string) {
  return prisma.perfilAcesso.findMany({
    where: { contaId },
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });
}
