import "server-only";

import type { PlanoContratado, StatusConta } from "@prisma/client";

import { prisma } from "./db";

// Único repositório de Conta (AD-13, Story 1.4) — Conta é a raiz do
// isolamento multi-tenant (AD-1), não filha dele: nenhuma função abaixo
// filtra por um contaId "do chamador". O isolamento real desta área vem do
// gate exigirOperadorDePlataforma() (server/auth/sessao.ts), nunca de um
// filtro de linha aqui.

// Listagem da área Contas (operador de plataforma): todas as contas-cliente
// da plataforma, com a contagem de usuários vinculados a cada uma (coluna
// "nº de usuários" do mockup).
export async function listarContas() {
  return prisma.conta.findMany({
    include: { _count: { select: { usuarios: true } } },
    orderBy: { nome: "asc" },
  });
}

export async function buscarConta(contaId: string) {
  return prisma.conta.findUnique({ where: { id: contaId } });
}

// "Nova conta" (Decisão confirmada no Intent): cria só a linha de Conta —
// nenhum Usuario/PerfilAcesso nasce junto. Uma conta criada aqui fica sem
// nenhum usuário capaz de logar até ser provisionada manualmente por fora do
// produto (limitação conhecida, registrada em deferred-work.md).
export async function criarConta(dados: {
  nome: string;
  cnpj: string;
  planoContratado: PlanoContratado;
  status: StatusConta;
}) {
  return prisma.conta.create({ data: dados });
}

// Edição: escopada por {id: contaId} — essa é a chave do alvo da edição, não
// um filtro de isolamento do chamador (a distinção que AD-13 exige). Retorna
// false (sem lançar) se a conta não existir, para a Server Action decidir a
// resposta sem expor detalhe interno.
export async function atualizarConta(
  contaId: string,
  dados: Partial<{
    nome: string;
    cnpj: string;
    planoContratado: PlanoContratado;
    status: StatusConta;
    // Aparência (CAP-11 / AD-11, Story 1.5) — validado contra
    // src/lib/paletas.ts antes de chegar aqui (atualizarPaletaAction);
    // este repositório não valida a chave, só grava.
    paletaDeCores: string;
  }>,
) {
  const resultado = await prisma.conta.updateMany({
    where: { id: contaId },
    data: dados,
  });
  return resultado.count > 0;
}
