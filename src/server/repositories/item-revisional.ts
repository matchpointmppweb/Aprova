import "server-only";

import type { StatusItemRevisional } from "@prisma/client";

import { prisma } from "./db";

// Única via de leitura/escrita de ItemRevisional (AD-1) — contaId sempre
// obrigatório e sempre aplicado ao `where`. Mesmo formato de
// src/server/repositories/tipo-ativo.ts/ativo.ts, usando
// updateMany({where:{id,contaId}}) para mutação cross-tenant-safe.

export async function listarItensRevisionais(contaId: string) {
  return prisma.itemRevisional.findMany({
    where: { contaId },
    orderBy: { nome: "asc" },
  });
}

export async function criarItemRevisional(
  contaId: string,
  dados: {
    nome: string;
    descricao: string | null;
    diasPadrao: number | null;
    kmPadrao: number | null;
    horasPadrao: number | null;
    status: StatusItemRevisional;
  },
) {
  return prisma.itemRevisional.create({
    data: {
      contaId,
      nome: dados.nome,
      descricao: dados.descricao,
      diasPadrao: dados.diasPadrao,
      kmPadrao: dados.kmPadrao,
      horasPadrao: dados.horasPadrao,
      status: dados.status,
    },
  });
}

// Escopado por {id, contaId} (AD-1) — um id de outra conta nunca é
// encontrado (count 0). Reaproveitado tanto por editarItemRevisionalAction
// quanto por excluirItemRevisionalAction (que só chama com
// {status:"Arquivado"}) — nunca DELETE físico (AD-10), sem duplicar lógica
// de update.
export async function atualizarItemRevisional(
  contaId: string,
  itemRevisionalId: string,
  dados: Partial<{
    nome: string;
    descricao: string | null;
    diasPadrao: number | null;
    kmPadrao: number | null;
    horasPadrao: number | null;
    status: StatusItemRevisional;
  }>,
) {
  const resultado = await prisma.itemRevisional.updateMany({
    where: { id: itemRevisionalId, contaId },
    data: dados,
  });
  return resultado.count > 0;
}
