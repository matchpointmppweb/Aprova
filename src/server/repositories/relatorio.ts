import "server-only";

import type { Prisma } from "@prisma/client";

import type { Periodo } from "@/src/lib/relatorios";

import { prisma } from "./db";

// Consultas dos RELATÓRIOS (C3). Leitura apenas — nenhuma função daqui
// escreve.
//
// Toda consulta é escopada por `contaId` (AD-1), inclusive as que passam por
// relação: o filtro vai no lado da Emissão, nunca só no lado da linha filha,
// porque `servicos_emissao` e `itens_executados_emissao` não têm contaId
// próprio e herdam o isolamento da emissão dona.
//
// O período filtra por `dataEmissao` — a data de NEGÓCIO da emissão. As
// linhas de serviço não têm data própria no modo `Duracao` (AD-28: duração é
// minutos, sem marcos), então não existe "data do lançamento" para filtrar.
// Filtrar pelos marcos do modo `Periodo` deixaria de fora justamente as
// linhas lançadas por horas.

function filtroDeData(periodo: Periodo): Prisma.DateTimeFilter | undefined {
  if (!periodo.de && !periodo.ate) return undefined;
  return {
    ...(periodo.de ? { gte: periodo.de } : {}),
    ...(periodo.ate ? { lte: periodo.ate } : {}),
  };
}

function whereDaEmissao(contaId: string, periodo: Periodo) {
  const dataEmissao = filtroDeData(periodo);
  return { contaId, ...(dataEmissao ? { dataEmissao } : {}) };
}

export async function lancamentosDeServico(contaId: string, periodo: Periodo) {
  return prisma.servicoEmissao.findMany({
    where: { emissao: whereDaEmissao(contaId, periodo) },
    select: {
      modo: true,
      duracaoMinutos: true,
      inicio: true,
      fim: true,
      pessoa: {
        select: { id: true, nome: true, cargo: { select: { descricao: true } } },
      },
    },
  });
}

export async function emissoesComServicos(contaId: string, periodo: Periodo) {
  return prisma.emissao.findMany({
    where: whereDaEmissao(contaId, periodo),
    select: {
      status: true,
      ativo: { select: { id: true, codigo: true, nome: true } },
      servicos: { select: { modo: true, duracaoMinutos: true, inicio: true, fim: true } },
    },
  });
}

export async function itensPendentes(contaId: string, periodo: Periodo) {
  return prisma.itemExecutadoEmissao.findMany({
    where: { executado: false, emissao: whereDaEmissao(contaId, periodo) },
    select: {
      observacao: true,
      itemRevisional: { select: { nome: true, categoria: true } },
      emissao: {
        select: {
          codigo: true,
          status: true,
          dataEmissao: true,
          ativo: { select: { codigo: true, nome: true } },
        },
      },
    },
    orderBy: [{ emissao: { dataEmissao: "desc" } }, { emissao: { codigo: "desc" } }],
  });
}

/// Fotografia de agora — sem período, de propósito: a pergunta é "como cada
/// ativo está hoje", e recortá-la por data devolveria "como estava".
///
/// `emissoes` traz só a MAIS RECENTE (take: 1), não todas: a tela mostra a
/// última revisão, e carregar o histórico inteiro de cada ativo para usar uma
/// linha seria arrastar a tabela de emissões inteira para a memória.
export async function ativosComUltimaEmissao(contaId: string) {
  return prisma.ativo.findMany({
    where: { contaId },
    select: {
      codigo: true,
      nome: true,
      status: true,
      localizacao: true,
      tipoAtivo: { select: { nome: true } },
      empresa: { select: { razaoSocial: true } },
      _count: { select: { emissoes: true } },
      emissoes: {
        select: { codigo: true, dataEmissao: true, status: true },
        orderBy: { dataEmissao: "desc" },
        take: 1,
      },
    },
    orderBy: { codigo: "asc" },
  });
}

export async function pessoasDoRelatorio(contaId: string) {
  return prisma.pessoa.findMany({
    where: { contaId },
    select: {
      nome: true,
      cpf: true,
      cargo: { select: { descricao: true } },
      funcao: { select: { descricao: true } },
      _count: { select: { servicosEmissao: true } },
    },
    orderBy: { nome: "asc" },
  });
}
