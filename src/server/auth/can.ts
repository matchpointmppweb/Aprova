import "server-only";

import type { Modulo } from "@prisma/client";

import { buscarPermissaoDoModulo } from "@/src/server/repositories/perfil-acesso";

export type AcaoPermissao = "criar" | "editar" | "excluir";

// Forma mínima de usuário exigida por can() — qualquer objeto com esses dois
// campos serve (ex. o retorno de exigirUsuarioAutenticado()).
export interface UsuarioParaAutorizacao {
  perfilAcessoId: string;
  contaId: string;
}

// AD-2 — autorização centralizada. Primeira aplicação real: toda Server
// Action/Route Handler de mutação chama can(usuario, acao, modulo) antes de
// qualquer efeito, e a UI usa o mesmo resultado para esconder/desabilitar
// controles — nunca uma checagem paralela.
//
// Lê a permissão do perfil de acesso do usuário, sempre escopada pela
// contaId do próprio usuário (nunca de input) — um perfilAcessoId de outra
// conta nunca é encontrado (buscarPermissaoDoModulo filtra por contaId).
export async function can(
  usuario: UsuarioParaAutorizacao,
  acao: AcaoPermissao,
  modulo: Modulo,
): Promise<boolean> {
  const permissao = await buscarPermissaoDoModulo(
    usuario.perfilAcessoId,
    usuario.contaId,
    modulo,
  );

  if (!permissao) {
    return false;
  }

  return permissao[acao];
}
