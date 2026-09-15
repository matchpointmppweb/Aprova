import "server-only";

import { prisma } from "./db";

// Única via de leitura/escrita de Empresa (AD-1) — contaId sempre obrigatório
// e sempre aplicado ao `where`. Mesmo formato de
// src/server/repositories/local.ts, usando updateMany({where:{id,contaId}})
// para mutação cross-tenant-safe. Sem `status`/`areaPoligono` — Empresa não
// tem coluna de status nem ação de excluir (Boundaries/AD-17).

export async function listarEmpresas(contaId: string) {
  return prisma.empresa.findMany({
    where: { contaId },
    orderBy: { razaoSocial: "asc" },
  });
}

export async function criarEmpresa(
  contaId: string,
  dados: {
    razaoSocial: string;
    nomeFantasia: string;
    cnpj: string | null;
    cpf: string | null;
    observacao: string | null;
  },
) {
  return prisma.empresa.create({
    data: {
      contaId,
      razaoSocial: dados.razaoSocial,
      nomeFantasia: dados.nomeFantasia,
      cnpj: dados.cnpj,
      cpf: dados.cpf,
      observacao: dados.observacao,
    },
  });
}

// Escopado por {id, contaId} (AD-1) — um id de outra conta nunca é
// encontrado (count 0), e a Server Action decide a resposta sem expor
// detalhe interno (I/O Matrix: "Empresa de outra conta").
export async function atualizarEmpresa(
  contaId: string,
  empresaId: string,
  dados: {
    razaoSocial: string;
    nomeFantasia: string;
    cnpj: string | null;
    cpf: string | null;
    observacao: string | null;
  },
) {
  const resultado = await prisma.empresa.updateMany({
    where: { id: empresaId, contaId },
    data: {
      razaoSocial: dados.razaoSocial,
      nomeFantasia: dados.nomeFantasia,
      cnpj: dados.cnpj,
      cpf: dados.cpf,
      observacao: dados.observacao,
    },
  });
  return resultado.count > 0;
}
