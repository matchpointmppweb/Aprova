import "server-only";

import type { StatusPlanoRevisional } from "@prisma/client";

import { prisma } from "./db";

// Única via de leitura/escrita de PlanoRevisional/PlanoItemRevisional (AD-1)
// — contaId sempre obrigatório e sempre aplicado ao `where`. Mesmo formato
// de src/server/repositories/ativo.ts/item-revisional.ts, usando
// updateMany/prisma.$transaction escopados por {id, contaId} para mutação
// cross-tenant-safe.

export type DadosItemDoPlano = {
  itemRevisionalId: string;
  diasOverride: number | null;
  kmOverride: number | null;
  horasOverride: number | null;
};

export type DadosPlano = {
  nome: string;
  ativoId: string | null;
  tipoAtivoId: string | null;
  responsavelId: string;
  itens: DadosItemDoPlano[];
};

const INCLUDE_LISTAGEM = {
  ativo: { select: { id: true, nome: true } },
  tipoAtivo: { select: { id: true, nome: true } },
  responsavel: { select: { id: true, nome: true } },
  itens: {
    select: {
      id: true,
      itemRevisionalId: true,
      diasOverride: true,
      kmOverride: true,
      horasOverride: true,
    },
  },
} as const;

// Listagem da tela Planos revisionais — inclui ativo/tipoAtivo/responsavel/
// itens (Code Map) para a tabela montar "Vinculado a"/"Itens revisionais"
// sem N+1. Status/próxima revisão NUNCA vêm daqui — a página agrega
// resolverAtivosDoPlano por planoId à parte (AD-8).
export async function listarPlanos(contaId: string) {
  return prisma.planoRevisional.findMany({
    where: { contaId },
    include: INCLUDE_LISTAGEM,
    orderBy: { nome: "asc" },
  });
}

// Busca um único plano (para o modal de edição) com itens completos —
// escopado por {id, contaId} (AD-1), um id de outra conta nunca é
// encontrado.
export async function buscarPlano(contaId: string, id: string) {
  return prisma.planoRevisional.findFirst({
    where: { id, contaId },
    include: INCLUDE_LISTAGEM,
  });
}

// Cria PlanoRevisional + PlanoItemRevisional[] juntos numa única transação
// (AD-9) — nunca chamadas sequenciais não-transacionais para a mesma
// operação lógica (Boundaries).
export async function criarPlano(contaId: string, dados: DadosPlano) {
  return prisma.$transaction(async (tx) => {
    return tx.planoRevisional.create({
      data: {
        contaId,
        nome: dados.nome,
        ativoId: dados.ativoId,
        tipoAtivoId: dados.tipoAtivoId,
        responsavelId: dados.responsavelId,
        itens: {
          create: dados.itens.map((item) => ({
            itemRevisionalId: item.itemRevisionalId,
            diasOverride: item.diasOverride,
            kmOverride: item.kmOverride,
            horasOverride: item.horasOverride,
          })),
        },
      },
      include: INCLUDE_LISTAGEM,
    });
  });
}

// Resultado da tentativa de atualização — permite a Server Action distinguir
// "não encontrado nesta conta" (id de outra conta / id inexistente) de
// "conflito de lock otimista" (updatedAt não bateu), que têm mensagens de
// erro diferentes no I/O Matrix.
export type ResultadoAtualizarPlano =
  | { ok: true }
  | { ok: false; motivo: "nao-encontrado" | "conflito" };

// Edição de um plano existente: deleta+recria as linhas de item dentro da
// mesma transação (mais simples e seguro que diff incremental para uma
// lista pequena — Design Notes) e exige `updatedAtEsperado` na cláusula
// `where` da atualização do plano pai (lock otimista, AD-9). Se
// `updatedAtEsperado` não bater com o valor atual, a atualização não afeta
// nenhuma linha e a transação é abortada sem sobrescrever nada — a Server
// Action então distingue "não encontrado" de "conflito" checando se o plano
// ainda existe nesta conta.
export async function atualizarPlano(
  contaId: string,
  id: string,
  updatedAtEsperado: Date,
  dados: DadosPlano,
): Promise<ResultadoAtualizarPlano> {
  try {
    await prisma.$transaction(async (tx) => {
      const resultado = await tx.planoRevisional.updateMany({
        where: { id, contaId, updatedAt: updatedAtEsperado },
        data: {
          nome: dados.nome,
          ativoId: dados.ativoId,
          tipoAtivoId: dados.tipoAtivoId,
          responsavelId: dados.responsavelId,
        },
      });

      if (resultado.count === 0) {
        // updateMany não lança quando não encontra nada — força um erro
        // para abortar a transação (nenhuma linha de item é tocada) e cair
        // no catch abaixo, onde decidimos "não encontrado" vs. "conflito".
        throw new Error("PLANO_NAO_ATUALIZADO");
      }

      await tx.planoItemRevisional.deleteMany({ where: { planoId: id } });
      if (dados.itens.length > 0) {
        await tx.planoItemRevisional.createMany({
          data: dados.itens.map((item) => ({
            planoId: id,
            itemRevisionalId: item.itemRevisionalId,
            diasOverride: item.diasOverride,
            kmOverride: item.kmOverride,
            horasOverride: item.horasOverride,
          })),
        });
      }
    });

    return { ok: true };
  } catch (erro) {
    if (erro instanceof Error && erro.message === "PLANO_NAO_ATUALIZADO") {
      // Distingue "id de outra conta / inexistente" (Boundaries: erro
      // genérico) de "conflito de lock otimista" (mensagem específica),
      // fora da transação que acabou de abortar.
      const aindaExiste = await prisma.planoRevisional.findFirst({
        where: { id, contaId },
        select: { id: true },
      });
      return { ok: false, motivo: aindaExiste ? "conflito" : "nao-encontrado" };
    }
    throw erro;
  }
}

// "Excluir" nunca é DELETE físico (AD-10): reaproveita a mesma via de
// atualização usada pela edição comum, só que sem exigir lock otimista nem
// tocar nas linhas de item (Boundaries: "linhas de item continuam no
// banco"). Escopado por {id, contaId} (AD-1).
export async function arquivarPlano(contaId: string, id: string) {
  const resultado = await prisma.planoRevisional.updateMany({
    where: { id, contaId },
    data: { status: "Arquivado" as StatusPlanoRevisional },
  });
  return resultado.count > 0;
}

export type ResolucaoAtivoDoPlano = {
  ativoId: string;
  planoId: string;
  proximaData: Date | null;
  pendente: boolean;
};

// Exportado (não só local) porque o painel inicial (Story 4.3) também
// precisa converter dias<->ms ao formatar "Vence em N dias" a partir de
// `proximaData` — mesma constante, nunca redeclarada em outro arquivo.
export const MS_POR_DIA = 24 * 60 * 60 * 1000;
const JANELA_VENCE_EM_BREVE_DIAS = 7;

// Fórmula de agendamento (Design Notes / Boundaries, decisão confirmada sem
// base documental): proximaData(ativo, plano) = MIN(ativo.createdAt +
// diasEfetivo(item)) entre os itens selecionados do plano que têm controle
// de dias (próprio ou sobrescrito) não-nulo. diasEfetivo(item) =
// override.diasOverride ?? item.diasPadrao. Itens só de km/horas não
// contribuem (Epic 4 ainda não existe Emissão com histórico de medição
// real). Se nenhum item selecionado tiver controle de dias, proximaData é
// null e pendente é false.
function calcularProximaData(
  ativoCreatedAt: Date,
  itens: {
    diasOverride: number | null;
    itemRevisional: { diasPadrao: number | null };
  }[],
): Date | null {
  let menorData: Date | null = null;

  for (const item of itens) {
    const diasEfetivo = item.diasOverride ?? item.itemRevisional.diasPadrao;
    if (diasEfetivo === null) continue;

    const data = new Date(ativoCreatedAt.getTime() + diasEfetivo * MS_POR_DIA);
    if (menorData === null || data.getTime() < menorData.getTime()) {
      menorData = data;
    }
  }

  return menorData;
}

function calcularPendente(proximaData: Date | null, agora: Date): boolean {
  if (proximaData === null) return false;
  const limite = new Date(agora.getTime() + JANELA_VENCE_EM_BREVE_DIAS * MS_POR_DIA);
  // Inclui datas já vencidas — não existe um terceiro estado "vencido" no
  // vocabulário do produto, só "No prazo"/"Vence em breve" (Boundaries).
  return proximaData.getTime() <= limite.getTime();
}

// Função central de status/próxima revisão (AD-8) — vive só aqui. Todo
// consumidor futuro de pendência (esta tela, validação de emissão e painel
// no Epic 4) chama só esta função, nunca reimplementa a junção
// ativo<->tipo<->plano. Um plano-por-tipo expande para uma linha por ativo
// daquele tipo; `planoId` omitido calcula para a conta inteira. Só planos
// com status:'Ativo' entram no cálculo — um plano arquivado some daqui
// (Boundaries) mas continua no banco com seus vínculos de item intactos. Só
// Ativo com status:'Ativo' é resolvido (vínculo direto ou por tipo) — um
// ativo Inativo/Bloqueado/Vendido não precisa mais de revisão, então nunca
// gera pendência (achado de revisão, patch aplicado).
export async function resolverAtivosDoPlano(
  contaId: string,
  planoId?: string,
): Promise<ResolucaoAtivoDoPlano[]> {
  const agora = new Date();

  const planos = await prisma.planoRevisional.findMany({
    where: {
      contaId,
      status: "Ativo",
      ...(planoId ? { id: planoId } : {}),
    },
    include: {
      itens: {
        select: {
          diasOverride: true,
          itemRevisional: { select: { diasPadrao: true } },
        },
      },
    },
  });

  if (planos.length === 0) return [];

  // Ativos por vínculo direto (planos por Ativo específico).
  const ativoIdsDiretos = planos
    .map((plano) => plano.ativoId)
    .filter((id): id is string => id !== null);

  // Tipos vinculados (planos por Tipo de ativo) — expandem para todo Ativo
  // daquele tipoAtivoId nesta conta (AD-8).
  const tipoAtivoIds = planos
    .map((plano) => plano.tipoAtivoId)
    .filter((id): id is string => id !== null);

  const [ativosDiretos, ativosPorTipo] = await Promise.all([
    ativoIdsDiretos.length > 0
      ? prisma.ativo.findMany({
          where: { contaId, id: { in: ativoIdsDiretos }, status: "Ativo" },
          select: { id: true, tipoAtivoId: true, createdAt: true },
        })
      : Promise.resolve([]),
    tipoAtivoIds.length > 0
      ? prisma.ativo.findMany({
          where: { contaId, tipoAtivoId: { in: tipoAtivoIds }, status: "Ativo" },
          select: { id: true, tipoAtivoId: true, createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  const ativoPorId = new Map(ativosDiretos.map((ativo) => [ativo.id, ativo]));
  const ativosPorTipoAtivoId = new Map<string, typeof ativosPorTipo>();
  for (const ativo of ativosPorTipo) {
    const lista = ativosPorTipoAtivoId.get(ativo.tipoAtivoId) ?? [];
    lista.push(ativo);
    ativosPorTipoAtivoId.set(ativo.tipoAtivoId, lista);
  }

  const resultado: ResolucaoAtivoDoPlano[] = [];

  for (const plano of planos) {
    const ativosResolvidos = plano.ativoId
      ? (() => {
          const ativo = ativoPorId.get(plano.ativoId);
          return ativo ? [ativo] : [];
        })()
      : plano.tipoAtivoId
        ? (ativosPorTipoAtivoId.get(plano.tipoAtivoId) ?? [])
        : [];

    for (const ativo of ativosResolvidos) {
      const proximaData = calcularProximaData(ativo.createdAt, plano.itens);
      resultado.push({
        ativoId: ativo.id,
        planoId: plano.id,
        proximaData,
        pendente: calcularPendente(proximaData, agora),
      });
    }
  }

  return resultado;
}
