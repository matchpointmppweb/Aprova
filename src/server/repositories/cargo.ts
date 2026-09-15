import "server-only";

import type { StatusCargo } from "@prisma/client";

import { prisma } from "./db";

// Única via de leitura/escrita de Cargo (AD-1) — contaId sempre obrigatório
// e sempre aplicado ao `where`. Mesmo formato de
// src/server/repositories/local.ts, usando updateMany({where:{id,contaId}})
// para mutação cross-tenant-safe. Sem abstração compartilhada com
// src/server/repositories/funcao.ts (Boundaries/Never da story), mesmo
// tendo o shape idêntico.

export async function listarCargos(contaId: string) {
  return prisma.cargo.findMany({
    where: { contaId },
    orderBy: { descricao: "asc" },
  });
}

export async function criarCargo(
  contaId: string,
  dados: { descricao: string; status: StatusCargo },
) {
  return prisma.cargo.create({
    data: {
      contaId,
      descricao: dados.descricao,
      status: dados.status,
    },
  });
}

// Escopado por {id, contaId} (AD-1) — um id de outra conta nunca é
// encontrado (count 0), e a Server Action decide a resposta sem expor
// detalhe interno (I/O Matrix: "Cargo/Função de outra conta" — este arquivo
// cobre o caso "Cargo").
export async function atualizarCargo(
  contaId: string,
  cargoId: string,
  dados: { descricao: string; status: StatusCargo },
) {
  const resultado = await prisma.cargo.updateMany({
    where: { id: cargoId, contaId },
    data: {
      descricao: dados.descricao,
      status: dados.status,
    },
  });
  return resultado.count > 0;
}
