import "server-only";

import { Prisma, type StatusAtivo } from "@prisma/client";

import { prisma } from "./db";

// Única via de leitura/escrita de Ativo (AD-1) — contaId sempre obrigatório
// e sempre aplicado ao `where`. Mesmo formato de
// src/server/repositories/tipo-ativo.ts, usando updateMany({where:{id,contaId}})
// para mutação cross-tenant-safe.

// listarAtivos inclui tipoAtivo:{select:{nome:true}} para exibir o nome do
// tipo na tabela sem N+1 (Code Map).
export async function listarAtivos(contaId: string) {
  return prisma.ativo.findMany({
    where: { contaId },
    include: { tipoAtivo: { select: { nome: true } } },
    orderBy: { nome: "asc" },
  });
}

function formatarCodigo(sequencial: number) {
  return `AT-${String(sequencial).padStart(4, "0")}`;
}

// Código gerado no formato "AT-" + 4 dígitos com zero à esquerda, sequencial
// por conta, sem ano embutido (Boundaries). Gerado dentro de
// prisma.$transaction({isolationLevel: Serializable}), que conta os Ativo já
// existentes na conta e cria com codigo = "AT-" + pad(count+1,4) — mesmo
// padrão de transação serializável já usado em editarUsuarioAction (Story
// 1.2) para fechar corrida em contagem. Nunca reaproveita cuid() como código
// visível. Sob concorrência real, a segunda transação que colidir com a
// primeira recebe um erro de serialização do Postgres (P2034) em vez de
// gerar um código duplicado — a Server Action chamadora trata isso como uma
// falha genérica (o usuário reenvia o formulário).
export async function criarAtivo(
  contaId: string,
  dados: {
    nome: string;
    tipoAtivoId: string;
    localizacao: string;
    numeroSerie: string | null;
    status: StatusAtivo;
  },
) {
  return prisma.$transaction(
    async (tx) => {
      const totalExistente = await tx.ativo.count({ where: { contaId } });
      const codigo = formatarCodigo(totalExistente + 1);
      return tx.ativo.create({
        data: {
          contaId,
          nome: dados.nome,
          tipoAtivoId: dados.tipoAtivoId,
          localizacao: dados.localizacao,
          numeroSerie: dados.numeroSerie,
          codigo,
          status: dados.status,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

// Escopado por {id, contaId} (AD-1) — um id de outra conta nunca é
// encontrado (count 0). Reaproveitado tanto por editarAtivoAction quanto por
// excluirAtivoAction (que só chama com {status:"Inativo"}) — nunca DELETE
// físico (AD-10), sem duplicar lógica de update.
export async function atualizarAtivo(
  contaId: string,
  ativoId: string,
  dados: Partial<{
    nome: string;
    tipoAtivoId: string;
    localizacao: string;
    numeroSerie: string | null;
    status: StatusAtivo;
  }>,
) {
  const resultado = await prisma.ativo.updateMany({
    where: { id: ativoId, contaId },
    data: dados,
  });
  return resultado.count > 0;
}
