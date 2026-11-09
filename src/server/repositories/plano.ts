import "server-only";

import type { StatusPlanoRevisional } from "@prisma/client";

import { prisma } from "./db";
import { aplicarNomeDoVinculo, aplicarNomeDoVinculoEmLista } from "./vinculo-conta";

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
  /// Terceiro lado do XOR (Frente A) — plano que cobre todos os ativos cuja
  /// empresa proprietária é esta.
  empresaId: string | null;
  responsavelId: string;
  itens: DadosItemDoPlano[];
};

const INCLUDE_LISTAGEM = {
  ativo: { select: { id: true, nome: true } },
  tipoAtivo: { select: { id: true, nome: true } },
  empresa: { select: { id: true, razaoSocial: true } },
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
//
// O nome do responsável passa pela resolução por vínculo (Story 6.6): o que a
// relação com `Usuario` traz é o nome da IDENTIDADE, que pode ter sido digitado
// por outra conta — exibi-lo aqui reabriria a sondagem de nomes que a story
// fechou no convite (NFR2).
export async function listarPlanos(contaId: string) {
  const planos = await prisma.planoRevisional.findMany({
    where: { contaId },
    include: INCLUDE_LISTAGEM,
    orderBy: { nome: "asc" },
  });
  return aplicarNomeDoVinculoEmLista(contaId, planos);
}

// Busca um único plano (para o modal de edição) com itens completos —
// escopado por {id, contaId} (AD-1), um id de outra conta nunca é
// encontrado.
export async function buscarPlano(contaId: string, id: string) {
  const plano = await prisma.planoRevisional.findFirst({
    where: { id, contaId },
    include: INCLUDE_LISTAGEM,
  });
  return aplicarNomeDoVinculo(contaId, plano);
}

// Story 7.5 (AD-32) — a busca que faltava: planos A PARTIR de um ativo. É o
// caminho inverso de `resolverAtivosDoPlano`, e não uma variante dele: ali a
// pergunta é "que ativos este plano cobre", aqui é "que planos cobrem este
// ativo". Traz os DOIS níveis de preferência (plano por ativo e plano pelo tipo
// do ativo) sem escolher entre eles — a escolha é de `derivarPlanoDoAtivo`
// (actions/emissao-estado.ts), a MESMA função que a tela usa.
//
// Escopado por contaId dos dois lados (AD-1): um ativo de outra conta devolve
// `null`, nunca os planos dela. Só planos `Ativo` entram — um plano arquivado
// não é candidato (Boundaries).
export async function planosCandidatosDoAtivo(contaId: string, ativoId: string) {
  const ativo = await prisma.ativo.findFirst({
    where: { id: ativoId, contaId },
    select: { id: true, tipoAtivoId: true, empresaId: true },
  });
  if (!ativo) return null;

  const planos = await prisma.planoRevisional.findMany({
    where: {
      contaId,
      status: "Ativo",
      OR: [
        { ativoId: ativo.id },
        { tipoAtivoId: ativo.tipoAtivoId },
        // Só quando o ativo TEM dona: `empresaId: null` casaria com todo
        // plano-por-ativo e plano-por-tipo (que têm empresaId nulo pelo XOR)
        // e traria candidato que não cobre coisa nenhuma.
        ...(ativo.empresaId ? [{ empresaId: ativo.empresaId }] : []),
      ],
    },
    select: {
      id: true,
      nome: true,
      status: true,
      ativoId: true,
      tipoAtivoId: true,
      empresaId: true,
      itens: {
        select: {
          itemRevisionalId: true,
          diasOverride: true,
          kmOverride: true,
          horasOverride: true,
        },
      },
    },
    orderBy: { nome: "asc" },
  });

  return { ativo, planos };
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
        empresaId: dados.empresaId,
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
          empresaId: dados.empresaId,
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

// Fórmula de agendamento: proximaData(ativo, plano) = MIN(base(item) +
// diasEfetivo(item)) entre os itens selecionados do plano que têm controle de
// dias (próprio ou sobrescrito) não-nulo. diasEfetivo(item) =
// override.diasOverride ?? item.diasPadrao. Itens só de km/horas não
// contribuem. Se nenhum item selecionado tiver controle de dias, proximaData
// é null e pendente é false.
//
// `base(item)` é a data da ÚLTIMA execução aprovada daquele item neste ativo
// por este plano — e `ativo.createdAt` só quando nunca houve nenhuma.
//
// Era só `ativo.createdAt` até aqui, e isso tornava o atraso permanente: a
// conta não olhava o histórico de emissões, então qualquer ativo mais velho
// que o intervalo do seu plano aparecia Atrasado para sempre, tivesse ele dez
// revisões concluídas ou nenhuma. Nada o trazia de volta para No prazo, e a
// tela de Planos — que existe para dizer o que fazer hoje — ficava inteira
// vermelha e sem informação. Achado ao semear dados de demonstração com
// ativos de idades variadas (05-11-2026).
//
// A base é por ITEM, não por emissão: uma emissão que executou a troca de
// óleo e não a inspeção de freios adia só a troca de óleo. Tomar a data da
// emissão para todos os itens dela adiaria o que ninguém fez.
//
// Só emissão `Emitido` conta. Um rascunho ou uma emissão em análise descrevem
// serviço que ainda não foi aprovado, e deixá-los adiar a revisão permitiria
// zerar a pendência de um ativo sem nunca concluir nada.
function calcularProximaData(
  ativoCreatedAt: Date,
  itens: {
    itemRevisionalId: string;
    diasOverride: number | null;
    itemRevisional: { diasPadrao: number | null };
  }[],
  ultimaExecucaoDoItem: ReadonlyMap<string, Date>,
): Date | null {
  let menorData: Date | null = null;

  for (const item of itens) {
    const diasEfetivo = item.diasOverride ?? item.itemRevisional.diasPadrao;
    if (diasEfetivo === null) continue;

    const base = ultimaExecucaoDoItem.get(item.itemRevisionalId) ?? ativoCreatedAt;
    const data = new Date(base.getTime() + diasEfetivo * MS_POR_DIA);
    if (menorData === null || data.getTime() < menorData.getTime()) {
      menorData = data;
    }
  }

  return menorData;
}

/// Chave de `(ativo, plano, item)` para o histórico de execução. Função
/// própria, e não template inline nos dois lugares, porque montar a chave de
/// um lado e lê-la do outro com ordens diferentes falharia em silêncio — o
/// `get` devolveria `undefined` e tudo voltaria a contar da entrada do ativo,
/// que é exatamente o defeito que esta mudança corrige.
function chaveDeExecucao(ativoId: string, planoId: string, itemRevisionalId: string): string {
  return `${ativoId}|${planoId}|${itemRevisionalId}`;
}

/// Data da última execução APROVADA de cada item, por ativo e plano.
///
/// Uma consulta só para a conta inteira (ou para um plano, quando a tela pede
/// um), e não uma por ativo: `resolverAtivosDoPlano` roda na listagem de
/// Planos e no painel inicial, onde um N+1 por ativo apareceria na hora.
async function historicoDeExecucao(contaId: string, planoId?: string): Promise<Map<string, Date>> {
  const emissoes = await prisma.emissao.findMany({
    where: {
      contaId,
      status: "Emitido",
      ...(planoId ? { planoId } : {}),
    },
    select: {
      ativoId: true,
      planoId: true,
      dataEmissao: true,
      itens: {
        where: { executado: true },
        select: { itemRevisionalId: true },
      },
    },
  });

  const ultima = new Map<string, Date>();
  for (const emissao of emissoes) {
    for (const item of emissao.itens) {
      const chave = chaveDeExecucao(emissao.ativoId, emissao.planoId, item.itemRevisionalId);
      const atual = ultima.get(chave);
      // A MAIS RECENTE vence: duas emissões do mesmo item adiam a revisão até
      // a última, não até a primeira que a consulta devolveu.
      if (!atual || emissao.dataEmissao.getTime() > atual.getTime()) {
        ultima.set(chave, emissao.dataEmissao);
      }
    }
  }
  return ultima;
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

  const [planos, ultimaExecucao] = await Promise.all([
    prisma.planoRevisional.findMany({
      where: {
        contaId,
        status: "Ativo",
        ...(planoId ? { id: planoId } : {}),
      },
      include: {
        itens: {
          select: {
            // `itemRevisionalId` entra aqui porque é a chave do histórico de
            // execução: sem ele não há como saber de QUAL item é a última
            // data aprovada.
            itemRevisionalId: true,
            diasOverride: true,
            itemRevisional: { select: { diasPadrao: true } },
          },
        },
      },
    }),
    historicoDeExecucao(contaId, planoId),
  ]);

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

  // Empresas vinculadas (planos por Empresa, Frente A) — expandem para todo
  // Ativo cuja empresa PROPRIETÁRIA é aquela. Mesma natureza da expansão por
  // tipo: cobertura calculada na leitura, nunca uma linha por ativo (AD-8).
  const empresaIds = planos
    .map((plano) => plano.empresaId)
    .filter((id): id is string => id !== null);

  const [ativosDiretos, ativosPorTipo, ativosPorEmpresa] = await Promise.all([
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
    empresaIds.length > 0
      ? prisma.ativo.findMany({
          where: { contaId, empresaId: { in: empresaIds }, status: "Ativo" },
          select: { id: true, tipoAtivoId: true, empresaId: true, createdAt: true },
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

  const ativosPorEmpresaId = new Map<string, typeof ativosPorEmpresa>();
  for (const ativo of ativosPorEmpresa) {
    // `empresaId` é não-nulo por construção (veio do `in: empresaIds`), mas
    // o tipo não sabe disso — o guard evita uma chave "null" no Map.
    if (!ativo.empresaId) continue;
    const lista = ativosPorEmpresaId.get(ativo.empresaId) ?? [];
    lista.push(ativo);
    ativosPorEmpresaId.set(ativo.empresaId, lista);
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
        : plano.empresaId
          ? (ativosPorEmpresaId.get(plano.empresaId) ?? [])
          : [];

    for (const ativo of ativosResolvidos) {
      // Histórico recortado para este par (ativo, plano): o cálculo por item
      // recebe só as datas que lhe dizem respeito, em vez de ter de conhecer
      // o formato da chave.
      const execucoesDesteAtivo = new Map<string, Date>();
      for (const item of plano.itens) {
        const data = ultimaExecucao.get(chaveDeExecucao(ativo.id, plano.id, item.itemRevisionalId));
        if (data) execucoesDesteAtivo.set(item.itemRevisionalId, data);
      }

      const proximaData = calcularProximaData(ativo.createdAt, plano.itens, execucoesDesteAtivo);
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
