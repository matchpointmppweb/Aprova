import "server-only";

import { Prisma, type StatusLocal } from "@prisma/client";

import { prisma } from "./db";

// Única via de leitura/escrita de Local (AD-1) — contaId sempre obrigatório
// e sempre aplicado ao `where`. Mesmo formato de
// src/server/repositories/tipo-ativo.ts, usando updateMany({where:{id,
// contaId}}) para mutação cross-tenant-safe.
//
// `areaPoligono` é puramente ilustrativo (AD-14): array de pontos {x,y}[]
// em coordenadas do viewBox do editor, gravado como Json opcional — nunca
// lat/long, nunca obrigatório.

export type AreaPoligono = { x: number; y: number }[] | null;

export async function listarLocais(contaId: string) {
  return prisma.local.findMany({
    where: { contaId },
    orderBy: { nome: "asc" },
  });
}

export async function criarLocal(
  contaId: string,
  dados: { nome: string; endereco: string; areaPoligono: AreaPoligono; status: StatusLocal },
) {
  return prisma.local.create({
    data: {
      contaId,
      nome: dados.nome,
      endereco: dados.endereco,
      areaPoligono: dados.areaPoligono ?? Prisma.DbNull,
      status: dados.status,
    },
  });
}

// Escopado por {id, contaId} (AD-1) — um id de outra conta nunca é
// encontrado (count 0), e a Server Action decide a resposta sem expor
// detalhe interno (I/O Matrix: "Local de outra conta").
export async function atualizarLocal(
  contaId: string,
  localId: string,
  dados: { nome: string; endereco: string; areaPoligono: AreaPoligono; status: StatusLocal },
) {
  const resultado = await prisma.local.updateMany({
    where: { id: localId, contaId },
    data: {
      nome: dados.nome,
      endereco: dados.endereco,
      areaPoligono: dados.areaPoligono ?? Prisma.DbNull,
      status: dados.status,
    },
  });
  return resultado.count > 0;
}
