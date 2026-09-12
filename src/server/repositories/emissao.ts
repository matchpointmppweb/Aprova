import "server-only";

import { Prisma, type StatusEmissao } from "@prisma/client";

import { prisma } from "./db";

// Única via de leitura/escrita de Emissao/ItemExecutadoEmissao (AD-1) —
// contaId sempre obrigatório e sempre aplicado ao `where`. Mesmo formato de
// src/server/repositories/plano.ts, usando updateMany/prisma.$transaction
// escopados por {id, contaId} para mutação cross-tenant-safe.

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
} as const;

// Listagem da tela Emissão — inclui ativo/plano/responsavel/itens (Code Map)
// para a tabela montar as colunas sem N+1.
export async function listarEmissoes(contaId: string) {
  return prisma.emissao.findMany({
    where: { contaId },
    include: INCLUDE_LISTAGEM,
    orderBy: [{ ano: "desc" }, { seq: "desc" }],
  });
}

// Busca uma única emissão (para o modal de edição) com itens completos —
// escopado por {id, contaId} (AD-1), um id de outra conta nunca é
// encontrado.
export async function buscarEmissao(contaId: string, id: string) {
  return prisma.emissao.findFirst({
    where: { id, contaId },
    include: INCLUDE_LISTAGEM,
  });
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

export type DadosCriarEmissao = {
  ativoId: string;
  planoId: string;
  responsavelId: string;
  dataEmissao: Date;
  itens: DadosItemExecutadoNovo[];
};

function formatarCodigo(ano: number, seq: number) {
  return `EM-${ano}-${String(seq).padStart(4, "0")}`;
}

function isErroDeColisaoDeCodigo(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
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
            codigo,
            ano,
            seq,
            status: "Rascunho" as StatusEmissao,
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
  | {
      trocouPlano: false;
      ativoId: string;
      planoId: string;
      responsavelId: string;
      dataEmissao: Date;
      itens: DadosItemExecutadoExistente[];
    }
  | {
      trocouPlano: true;
      ativoId: string;
      planoId: string;
      responsavelId: string;
      dataEmissao: Date;
      itens: DadosItemExecutadoNovo[];
    };

export type ResultadoAtualizarEmissao =
  | { ok: true }
  | { ok: false; motivo: "nao-encontrado" | "conflito" };

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
        },
      });

      if (resultado.count === 0) {
        // updateMany não lança quando não encontra nada — força um erro
        // para abortar a transação (nenhuma linha de item é tocada) e cair
        // no catch abaixo, onde decidimos "não encontrado" vs. "conflito".
        throw new Error("EMISSAO_NAO_ATUALIZADA");
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
    throw erro;
  }
}
