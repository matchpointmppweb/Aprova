import "server-only";

import type { StatusTipoAtivo } from "@prisma/client";

import { prisma } from "./db";

// Única via de leitura/escrita de TipoAtivo (AD-1) — contaId sempre
// obrigatório e sempre aplicado ao `where`. Mesmo formato de
// src/server/repositories/perfil-acesso.ts (listarPerfisAcessoCompleto/
// atualizarPerfilAcesso), usando updateMany({where:{id,contaId}}) para
// mutação cross-tenant-safe.
//
// A coluna "Ativos vinculados" da listagem é fixa em 0 nesta story (Intent/
// Boundaries) — não há relação `Ativo[]` a contar ainda. A Story 2.2, ao
// criar o modelo Ativo, deve trocar esse 0 fixo por uma contagem real
// (include: { _count: { select: { ativos: true } } }, mesmo padrão de
// listarPerfisAcessoCompleto).

export async function listarTiposAtivo(contaId: string) {
  return prisma.tipoAtivo.findMany({
    where: { contaId },
    orderBy: { nome: "asc" },
  });
}

export async function criarTipoAtivo(
  contaId: string,
  dados: { nome: string; descricao: string | null; status: StatusTipoAtivo },
) {
  return prisma.tipoAtivo.create({
    data: {
      contaId,
      nome: dados.nome,
      descricao: dados.descricao,
      status: dados.status,
    },
  });
}

// Escopado por {id, contaId} (AD-1) — um id de outra conta nunca é
// encontrado (count 0), e a Server Action decide a resposta sem expor
// detalhe interno (I/O Matrix: "Tipo de outra conta").
export async function atualizarTipoAtivo(
  contaId: string,
  tipoAtivoId: string,
  dados: { nome: string; descricao: string | null; status: StatusTipoAtivo },
) {
  const resultado = await prisma.tipoAtivo.updateMany({
    where: { id: tipoAtivoId, contaId },
    data: {
      nome: dados.nome,
      descricao: dados.descricao,
      status: dados.status,
    },
  });
  return resultado.count > 0;
}
