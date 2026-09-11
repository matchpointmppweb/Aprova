import "server-only";

import type { Modulo } from "@prisma/client";

import { prisma } from "./db";

// Única via de leitura/escrita de PerfilAcesso/PermissaoModulo (AD-1) —
// contaId sempre obrigatório e sempre aplicado ao `where`.
// buscarPermissaoDoModulo (can()) e listarPerfisAcesso (dropdown de
// convite/edição de usuário, Story 1.2) já existiam e não mudam. A
// criação, leitura e edição de perfis (+ suas 8 linhas de permissão) são
// acrescentadas aqui pela Story 1.3 — não há exclusão de perfil nesta
// story.

export async function buscarPermissaoDoModulo(
  perfilAcessoId: string,
  contaId: string,
  modulo: Modulo,
) {
  return prisma.permissaoModulo.findFirst({
    where: { modulo, perfilAcesso: { id: perfilAcessoId, contaId } },
  });
}

export async function listarPerfisAcesso(contaId: string) {
  return prisma.perfilAcesso.findMany({
    where: { contaId },
    select: { id: true, nome: true },
    orderBy: { nome: "asc" },
  });
}

// Forma de uma linha de permissão como enviada pelo modal (Geral/Permissões)
// para criar/atualizar — mesmos 3 booleanos de PermissaoModulo, sem os
// campos de identidade (id/perfilAcessoId), que o repositório resolve.
export type PermissaoParaGravar = {
  modulo: Modulo;
  criar: boolean;
  editar: boolean;
  excluir: boolean;
};

// Listagem da tela Perfil de acesso (Story 1.3): nome, descrição, contagem
// de usuários vinculados e as linhas de permissão — o suficiente para a
// tabela (`.perm-badges`, resumo por módulo) sem uma 2ª consulta por perfil.
export async function listarPerfisAcessoCompleto(contaId: string) {
  return prisma.perfilAcesso.findMany({
    where: { contaId },
    include: {
      _count: { select: { usuarios: true } },
      permissoes: true,
    },
    orderBy: { nome: "asc" },
  });
}

// Leitura de um único perfil (com permissões) escopada pela conta — usada
// pelo modal de edição e, na Server Action, para checar o nome atual antes
// de aplicar a guarda de "Administrador não pode ser renomeado".
export async function buscarPerfilAcesso(contaId: string, perfilAcessoId: string) {
  return prisma.perfilAcesso.findFirst({
    where: { id: perfilAcessoId, contaId },
    include: { permissoes: true },
  });
}

// Criação: perfil + suas linhas de PermissaoModulo nascem juntos, no mesmo
// nested create (AD-9 — atômico por natureza, sem precisar de
// $transaction explícito, mesmo padrão de prisma/seed.ts).
export async function criarPerfilAcesso(
  contaId: string,
  dados: { nome: string; descricao: string | null; permissoes: PermissaoParaGravar[] },
) {
  return prisma.perfilAcesso.create({
    data: {
      contaId,
      nome: dados.nome,
      descricao: dados.descricao,
      permissoes: { create: dados.permissoes },
    },
  });
}

// Edição: nome/descrição do perfil + as (até 8) linhas de permissão são
// escritos numa única transação (AD-9) — nunca parcialmente aplicados se
// uma das escritas falhar. O update do perfil é escopado por
// {id, contaId} (AD-1); se não achar nada (perfil de outra conta ou
// inexistente), a transação inteira é abortada (count 0) sem tocar nas
// permissões, e a função retorna false para a Server Action decidir a
// resposta sem expor detalhe interno.
export async function atualizarPerfilAcesso(
  contaId: string,
  perfilAcessoId: string,
  dados: { nome: string; descricao: string | null; permissoes: PermissaoParaGravar[] },
) {
  return prisma.$transaction(async (tx) => {
    const resultado = await tx.perfilAcesso.updateMany({
      where: { id: perfilAcessoId, contaId },
      data: { nome: dados.nome, descricao: dados.descricao },
    });
    if (resultado.count === 0) {
      return false;
    }

    await Promise.all(
      dados.permissoes.map((permissao) =>
        tx.permissaoModulo.updateMany({
          where: { perfilAcessoId, modulo: permissao.modulo },
          data: {
            criar: permissao.criar,
            editar: permissao.editar,
            excluir: permissao.excluir,
          },
        }),
      ),
    );

    return true;
  });
}
