import "server-only";

import { Prisma, type Setor, type StatusEmissao } from "@prisma/client";

import { prisma } from "./db";
import { aplicarNomeDoVinculo, aplicarNomeDoVinculoEmLista } from "./vinculo-conta";

// Única via de leitura/escrita de Emissao/ItemExecutadoEmissao (AD-1) —
// contaId sempre obrigatório e sempre aplicado ao `where`. Mesmo formato de
// src/server/repositories/plano.ts, usando updateMany/prisma.$transaction
// escopados por {id, contaId} para mutação cross-tenant-safe.

// Ordem determinística das linhas de serviço: atualizarEmissao recria todas
// elas com cuids novos a cada edição, então sem orderBy a ordem devolvida
// pelo banco não é garantida entre um save e o próximo. Fora do
// INCLUDE_LISTAGEM `as const` de propósito — um array readonly não é aceito
// pelo tipo de orderBy do Prisma.
const ORDEM_SERVICOS: Prisma.ServicoEmissaoOrderByWithRelationInput[] = [
  { inicio: "asc" },
  { id: "asc" },
];

const INCLUDE_LISTAGEM = {
  ativo: { select: { id: true, nome: true } },
  plano: { select: { id: true, nome: true } },
  responsavel: { select: { id: true, nome: true } },
  itens: {
    select: {
      id: true,
      itemRevisionalId: true,
      executado: true,
      valorEsperadoDias: true,
      valorEsperadoKm: true,
      valorEsperadoHoras: true,
      medicaoDias: true,
      medicaoKm: true,
      medicaoHoras: true,
      observacao: true,
    },
  },
  // Story 5.5: os três caminhos de leitura (listarEmissoes/buscarEmissao/o
  // retorno de criarEmissao) ganham os serviços de graça por viverem no
  // mesmo INCLUDE.
  servicos: {
    select: {
      id: true,
      pessoaId: true,
      itemRevisionalId: true,
      inicio: true,
      fim: true,
      // Story 7.1: modo e duração acompanham as datas nas três leituras
      // (listarEmissoes/buscarEmissao/retorno de criarEmissao) por viverem no
      // mesmo `select`.
      modo: true,
      duracaoMinutos: true,
    },
    orderBy: ORDEM_SERVICOS,
  },
} as const;

// Listagem da tela Emissão — inclui ativo/plano/responsavel/itens (Code Map)
// para a tabela montar as colunas sem N+1.
//
// O nome do responsável passa pela resolução por vínculo (Story 6.6), pelo mesmo
// motivo de listarPlanos: a relação com `Usuario` traz o nome da IDENTIDADE, que
// pode ter sido digitado por outra conta (NFR2).
export async function listarEmissoes(contaId: string) {
  const emissoes = await prisma.emissao.findMany({
    where: { contaId },
    include: INCLUDE_LISTAGEM,
    orderBy: [{ ano: "desc" }, { seq: "desc" }],
  });
  return aplicarNomeDoVinculoEmLista(contaId, emissoes);
}

// Busca uma única emissão (para o modal de edição) com itens completos —
// escopado por {id, contaId} (AD-1), um id de outra conta nunca é
// encontrado.
export async function buscarEmissao(contaId: string, id: string) {
  const emissao = await prisma.emissao.findFirst({
    where: { id, contaId },
    include: INCLUDE_LISTAGEM,
  });
  return aplicarNomeDoVinculo(contaId, emissao);
}

export type DadosItemExecutadoNovo = {
  itemRevisionalId: string;
  executado: boolean;
  valorEsperadoDias: number | null;
  valorEsperadoKm: number | null;
  valorEsperadoHoras: number | null;
  medicaoDias: number | null;
  medicaoKm: number | null;
  medicaoHoras: number | null;
  observacao: string | null;
};

// Uma linha da aba "Serviço" (Story 5.5) — sem id próprio: as linhas são
// sempre substituídas em bloco, nunca casadas com uma linha já persistida
// (Boundaries/AD-20).
type IdentidadeDoServico = {
  pessoaId: string;
  itemRevisionalId: string;
};

// Story 7.1 — UNIÃO DISCRIMINADA por `modo`, não três campos independentes:
// o tipo torna INEXPRIMÍVEIS os estados que a CHECK
// `servicos_emissao_modo_coerente` recusa (Duracao sem minutos, Duracao com
// datas, Periodo com minutos). A CHECK continua sendo a garantia real — ela
// cobre também o que vem de fora do TypeScript — mas o erro passa a aparecer
// na compilação, e não só em runtime.
export type DadosServicoEmissao =
  // Caminho de escrita LEGADO (Server Action da 5.5, intocada nesta story):
  // não conhece os campos novos e continua compilando e gravando como antes —
  // `Periodo` com duração nula (I/O Matrix: "Escrita legada").
  | (IdentidadeDoServico & {
      inicio: Date | null;
      fim: Date | null;
      modo?: undefined;
      duracaoMinutos?: undefined;
    })
  // Período explícito: as datas mandam, duração nunca é preenchida. Story 7.3 —
  // os dois marcos são OBRIGATÓRIOS aqui, espelhando o ramo `Periodo` da CHECK,
  // que deixou de aceitar período sem datas: o erro passa a aparecer na
  // compilação em vez de só em runtime.
  | (IdentidadeDoServico & {
      modo: "Periodo";
      inicio: Date;
      fim: Date;
      duracaoMinutos?: null;
    })
  // Duração digitada: minutos INTEIROS obrigatórios (AD-28) e datas
  // necessariamente ausentes.
  | (IdentidadeDoServico & {
      modo: "Duracao";
      duracaoMinutos: number;
      inicio?: null;
      fim?: null;
    });

// Campos gerais compartilhados pela criação e pelos dois braços da edição
// (Story 5.5 acrescentou setor + os 3 marcos opcionais de data/hora).
type CamposGeraisEmissao = {
  ativoId: string;
  planoId: string;
  responsavelId: string;
  dataEmissao: Date;
  setor: Setor;
  dataAgendamento: Date | null;
  dataInicio: Date | null;
  dataFim: Date | null;
  servicos: DadosServicoEmissao[];
};

export type DadosCriarEmissao = CamposGeraisEmissao & {
  itens: DadosItemExecutadoNovo[];
};

function formatarCodigo(ano: number, seq: number) {
  return `EM-${ano}-${String(seq).padStart(4, "0")}`;
}

function isErroDeColisaoDeCodigo(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

// Story 7.3 — a CHECK `servicos_emissao_modo_coerente` é REDE, não caminho: a
// Server Action valida o mesmo conjunto de regras antes (Design Notes), então
// uma violação aqui só acontece se a validação e o banco divergirem. Mesmo
// assim ela é CLASSIFICADA em vez de relançada, para a Server Action devolver
// um desfecho de campo — nunca um erro cru do Prisma nem um 500 (I/O Matrix).
//
// O Prisma não modela CHECK, então não há código de erro estável para ela: o
// reconhecimento é pelo NOME da constraint, que aparece na mensagem tanto no
// PrismaClientKnownRequestError (P2010) quanto no Unknown. É por isso que o
// nome vive nesta constante — mudá-lo na migration sem mudar aqui volta a
// produzir erro genérico, e é o teste de banco real que percebe.
const CONSTRAINT_MODO_COERENTE = "servicos_emissao_modo_coerente";

export function isViolacaoDeServicoIncoerente(erro: unknown): boolean {
  return erro instanceof Error && erro.message.includes(CONSTRAINT_MODO_COERENTE);
}

const MAX_TENTATIVAS_CODIGO = 5;

// Cria Emissao + ItemExecutadoEmissao[] juntos numa única transação (AD-9).
// Código sequencial "EM-{ano}-{seq}" gerado por retry-on-P2002 contra
// `@@unique([contaId, ano, seq])` (Boundaries) — NUNCA `select max`/
// transação Serializable (diferente de criarAtivo em ativo.ts): cada
// tentativa recalcula `seq` a partir da contagem atual dentro de uma nova
// transação (a tentativa anterior, se colidiu, foi revertida por inteiro —
// nunca deixa uma emissão parcial), e só desiste após
// MAX_TENTATIVAS_CODIGO tentativas, devolvendo o erro genérico para a Server
// Action decidir a mensagem (I/O Matrix: "Colisão de código").
export async function criarEmissao(contaId: string, dados: DadosCriarEmissao) {
  const ano = dados.dataEmissao.getFullYear();

  let ultimoErro: unknown;
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_CODIGO; tentativa++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const totalExistente = await tx.emissao.count({ where: { contaId, ano } });
        const seq = totalExistente + 1;
        const codigo = formatarCodigo(ano, seq);

        return tx.emissao.create({
          data: {
            contaId,
            ativoId: dados.ativoId,
            planoId: dados.planoId,
            responsavelId: dados.responsavelId,
            dataEmissao: dados.dataEmissao,
            setor: dados.setor,
            dataAgendamento: dados.dataAgendamento,
            dataInicio: dados.dataInicio,
            dataFim: dados.dataFim,
            codigo,
            ano,
            seq,
            status: "Rascunho" as StatusEmissao,
            // Irmão de `itens`: serviços entram na MESMA transação da
            // emissão (AD-9/AD-20). O retry de colisão de código não muda —
            // uma tentativa revertida derruba emissão, itens e serviços
            // juntos.
            servicos: {
              create: dados.servicos.map((servico) => ({
                pessoaId: servico.pessoaId,
                itemRevisionalId: servico.itemRevisionalId,
                // Sem `?? "Periodo"` (Story 7.3): o valor vem dos dados. Quando
                // o caminho legado o omite, `undefined` deixa o
                // `@default(Periodo)` do datamodel responder — o mesmo
                // resultado, sem um fallback que possa um dia apagar um modo
                // real.
                inicio: servico.inicio,
                fim: servico.fim,
                modo: servico.modo,
                duracaoMinutos: servico.duracaoMinutos,
              })),
            },
            itens: {
              create: dados.itens.map((item) => ({
                itemRevisionalId: item.itemRevisionalId,
                executado: item.executado,
                valorEsperadoDias: item.valorEsperadoDias,
                valorEsperadoKm: item.valorEsperadoKm,
                valorEsperadoHoras: item.valorEsperadoHoras,
                medicaoDias: item.medicaoDias,
                medicaoKm: item.medicaoKm,
                medicaoHoras: item.medicaoHoras,
                observacao: item.observacao,
              })),
            },
          },
          include: INCLUDE_LISTAGEM,
        });
      });
    } catch (erro) {
      if (isErroDeColisaoDeCodigo(erro) && tentativa < MAX_TENTATIVAS_CODIGO - 1) {
        ultimoErro = erro;
        continue;
      }
      throw erro;
    }
  }
  throw ultimoErro;
}

export type DadosItemExecutadoExistente = {
  itemRevisionalId: string;
  executado: boolean;
  medicaoDias: number | null;
  medicaoKm: number | null;
  medicaoHoras: number | null;
  observacao: string | null;
};

// Discrimina os dois fluxos de edição do Boundaries: `trocouPlano: false`
// atualiza in-place as linhas existentes por itemRevisionalId (preserva o
// progresso já registrado, nunca toca no snapshot de valorEsperado);
// `trocouPlano: true` descarta as linhas antigas e grava um novo snapshot a
// partir dos itens atuais do novo plano.
export type DadosEditarEmissao =
  | (CamposGeraisEmissao & {
      trocouPlano: false;
      itens: DadosItemExecutadoExistente[];
    })
  | (CamposGeraisEmissao & {
      trocouPlano: true;
      itens: DadosItemExecutadoNovo[];
    });

export type ResultadoAtualizarEmissao =
  | { ok: true }
  | { ok: false; motivo: "nao-encontrado" | "conflito" | "servico-incoerente" };

// Edição de uma emissão existente — exige `updatedAtEsperado` na cláusula
// `where` da atualização da emissão pai (lock otimista, AD-9), mesmo padrão
// de atualizarPlano. Se `updatedAtEsperado` não bater, a atualização não
// afeta nenhuma linha e a transação é abortada sem sobrescrever nada — a
// Server Action então distingue "não encontrado" de "conflito" checando se a
// emissão ainda existe nesta conta.
export async function atualizarEmissao(
  contaId: string,
  id: string,
  updatedAtEsperado: Date,
  dados: DadosEditarEmissao,
): Promise<ResultadoAtualizarEmissao> {
  try {
    await prisma.$transaction(async (tx) => {
      const resultado = await tx.emissao.updateMany({
        where: { id, contaId, updatedAt: updatedAtEsperado },
        data: {
          ativoId: dados.ativoId,
          planoId: dados.planoId,
          responsavelId: dados.responsavelId,
          dataEmissao: dados.dataEmissao,
          setor: dados.setor,
          dataAgendamento: dados.dataAgendamento,
          dataInicio: dados.dataInicio,
          dataFim: dados.dataFim,
        },
      });

      if (resultado.count === 0) {
        // updateMany não lança quando não encontra nada — força um erro
        // para abortar a transação (nenhuma linha de item/serviço é tocada)
        // e cair no catch abaixo, onde decidimos "não encontrado" vs.
        // "conflito".
        throw new Error("EMISSAO_NAO_ATUALIZADA");
      }

      // Story 5.5: serviços são substituídos EM BLOCO, sempre DEPOIS do
      // guard de lock otimista acima (Boundaries) — num conflito de edição a
      // transação já abortou e nenhuma linha de serviço foi tocada.
      // Diferente dos itens executados, uma linha de serviço não carrega
      // snapshot nem progresso a preservar, então nunca há update-in-place
      // aqui.
      await tx.servicoEmissao.deleteMany({ where: { emissaoId: id } });
      if (dados.servicos.length > 0) {
        await tx.servicoEmissao.createMany({
          data: dados.servicos.map((servico) => ({
            emissaoId: id,
            pessoaId: servico.pessoaId,
            itemRevisionalId: servico.itemRevisionalId,
            inicio: servico.inicio,
            fim: servico.fim,
            modo: servico.modo,
            duracaoMinutos: servico.duracaoMinutos,
          })),
        });
      }

      if (dados.trocouPlano) {
        // Trocou o plano vinculado: descarta as linhas antigas e grava um
        // novo snapshot a partir dos itens atuais do novo plano (Boundaries)
        // — nunca update-in-place aqui, o conjunto de itens é outro.
        await tx.itemExecutadoEmissao.deleteMany({ where: { emissaoId: id } });
        if (dados.itens.length > 0) {
          await tx.itemExecutadoEmissao.createMany({
            data: dados.itens.map((item) => ({
              emissaoId: id,
              itemRevisionalId: item.itemRevisionalId,
              executado: item.executado,
              valorEsperadoDias: item.valorEsperadoDias,
              valorEsperadoKm: item.valorEsperadoKm,
              valorEsperadoHoras: item.valorEsperadoHoras,
              medicaoDias: item.medicaoDias,
              medicaoKm: item.medicaoKm,
              medicaoHoras: item.medicaoHoras,
              observacao: item.observacao,
            })),
          });
        }
      } else {
        // Plano não mudou: atualiza cada linha existente in-place por
        // itemRevisionalId (executado/medição/observação), preservando o
        // progresso já registrado — nunca delete+recreate aqui (Boundaries).
        // valorEsperado* nunca é tocado: é o snapshot imutável.
        for (const item of dados.itens) {
          await tx.itemExecutadoEmissao.updateMany({
            where: { emissaoId: id, itemRevisionalId: item.itemRevisionalId },
            data: {
              executado: item.executado,
              medicaoDias: item.medicaoDias,
              medicaoKm: item.medicaoKm,
              medicaoHoras: item.medicaoHoras,
              observacao: item.observacao,
            },
          });
        }
      }
    });

    return { ok: true };
  } catch (erro) {
    if (erro instanceof Error && erro.message === "EMISSAO_NAO_ATUALIZADA") {
      // Distingue "id de outra conta / inexistente" (Boundaries: erro
      // genérico) de "conflito de lock otimista" (mensagem específica), fora
      // da transação que acabou de abortar.
      const aindaExiste = await prisma.emissao.findFirst({
        where: { id, contaId },
        select: { id: true },
      });
      return { ok: false, motivo: aindaExiste ? "conflito" : "nao-encontrado" };
    }
    if (isViolacaoDeServicoIncoerente(erro)) {
      // A transação já abortou por inteiro — nenhuma linha de serviço nem de
      // item sobreviveu (AD-9). Desfecho classificado em vez de erro cru.
      return { ok: false, motivo: "servico-incoerente" };
    }
    throw erro;
  }
}

export type ResultadoAtualizarStatusEmissao =
  | { ok: true }
  | { ok: false; motivo: "nao-encontrado" | "conflito" | "status-invalido" };

// Transição pontual de status (Story 4.2: enviar/aprovar/reprovar/reenviar)
// — updateMany escopado por {id, contaId, updatedAt: esperado, status:
// origemEsperada} (AD-1 + lock otimista AD-9 + validação do estado de
// origem esperado na MESMA cláusula where). Sem transação composta aqui
// (Code Map): nenhuma linha de item é tocada por nenhuma das 4 transições.
// 0 linhas afetadas não distingue por si só o motivo — reconsulta fora da
// atualização abortada (mesmo padrão de atualizarEmissao) para decidir entre
// três motivos: "não encontrado" (id de outra conta/inexistente),
// "status-invalido" (o status atual já não é mais o de origem esperado —
// ex.: tentou aprovar uma emissão que não está mais EmAnalise) e "conflito"
// (o status de origem ainda bate, mas o updatedAt mudou por outra edição
// concorrente, ex. edição de itens). `motivoReprovacao` só é gravado quando
// informado (reprovarEmissaoAction) — as outras 3 transições não tocam o
// campo, preservando o histórico da última reprovação (Boundaries/CAP-5).
export async function atualizarStatusEmissao(
  contaId: string,
  id: string,
  updatedAtEsperado: Date,
  statusOrigemEsperado: StatusEmissao,
  novoStatus: StatusEmissao,
  motivoReprovacao?: string,
): Promise<ResultadoAtualizarStatusEmissao> {
  const resultado = await prisma.emissao.updateMany({
    where: { id, contaId, updatedAt: updatedAtEsperado, status: statusOrigemEsperado },
    data: {
      status: novoStatus,
      ...(motivoReprovacao !== undefined ? { motivoReprovacao } : {}),
    },
  });

  if (resultado.count > 0) {
    return { ok: true };
  }

  const atual = await prisma.emissao.findFirst({
    where: { id, contaId },
    select: { status: true },
  });

  if (!atual) {
    return { ok: false, motivo: "nao-encontrado" };
  }
  if (atual.status !== statusOrigemEsperado) {
    return { ok: false, motivo: "status-invalido" };
  }
  return { ok: false, motivo: "conflito" };
}
