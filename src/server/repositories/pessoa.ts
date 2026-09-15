import "server-only";

import { prisma } from "./db";

// Única via de leitura/escrita de Pessoa (AD-1) — contaId sempre obrigatório
// e sempre aplicado ao `where`. Mesmo formato de
// src/server/repositories/empresa.ts, usando updateMany({where:{id,contaId}})
// para mutação cross-tenant-safe. Sem `status`/exclusão — Pessoa não tem
// coluna de status nem ação de excluir (Boundaries/AD-17/AD-18).
//
// listarPessoas inclui cargo/funcao (Code Map) para a tabela exibir o nome
// do Cargo/Função sem uma 2ª consulta — um Cargo/Função inativado depois
// continua vindo junto normalmente, a FK não quebra (I/O Matrix).

export async function listarPessoas(contaId: string) {
  return prisma.pessoa.findMany({
    where: { contaId },
    include: { cargo: true, funcao: true },
    orderBy: { nome: "asc" },
  });
}

export async function criarPessoa(
  contaId: string,
  dados: {
    nome: string;
    cpf: string;
    cargoId: string;
    funcaoId: string;
    observacao: string | null;
  },
) {
  return prisma.pessoa.create({
    data: {
      contaId,
      nome: dados.nome,
      cpf: dados.cpf,
      cargoId: dados.cargoId,
      funcaoId: dados.funcaoId,
      observacao: dados.observacao,
    },
  });
}

// Escopado por {id, contaId} (AD-1) — um id de outra conta nunca é
// encontrado (count 0), e a Server Action decide a resposta sem expor
// detalhe interno (I/O Matrix: "Pessoa de outra conta").
export async function atualizarPessoa(
  contaId: string,
  pessoaId: string,
  dados: {
    nome: string;
    cpf: string;
    cargoId: string;
    funcaoId: string;
    observacao: string | null;
  },
) {
  const resultado = await prisma.pessoa.updateMany({
    where: { id: pessoaId, contaId },
    data: {
      nome: dados.nome,
      cpf: dados.cpf,
      cargoId: dados.cargoId,
      funcaoId: dados.funcaoId,
      observacao: dados.observacao,
    },
  });
  return resultado.count > 0;
}
