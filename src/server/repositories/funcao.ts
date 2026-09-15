import "server-only";

import type { StatusFuncao } from "@prisma/client";

import { prisma } from "./db";

// Única via de leitura/escrita de Funcao (AD-1) — contaId sempre obrigatório
// e sempre aplicado ao `where`. Mesmo formato de
// src/server/repositories/local.ts, usando updateMany({where:{id,contaId}})
// para mutação cross-tenant-safe. Sem abstração compartilhada com
// src/server/repositories/cargo.ts (Boundaries/Never da story), mesmo tendo
// o shape idêntico.

export async function listarFuncoes(contaId: string) {
  return prisma.funcao.findMany({
    where: { contaId },
    orderBy: { descricao: "asc" },
  });
}

export async function criarFuncao(
  contaId: string,
  dados: { descricao: string; status: StatusFuncao },
) {
  return prisma.funcao.create({
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
// cobre o caso "Função").
export async function atualizarFuncao(
  contaId: string,
  funcaoId: string,
  dados: { descricao: string; status: StatusFuncao },
) {
  const resultado = await prisma.funcao.updateMany({
    where: { id: funcaoId, contaId },
    data: {
      descricao: dados.descricao,
      status: dados.status,
    },
  });
  return resultado.count > 0;
}
