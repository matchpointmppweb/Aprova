import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/src/server/auth";
import type { UsuarioSessao } from "@/src/server/auth/tipos";
import { buscarUsuarioAutenticado } from "@/src/server/repositories/usuario";

// Repete o padrão já usado em app/(dashboard)/layout.tsx
// (auth.api.getSession + buscarUsuarioAutenticado), extraído aqui para ser
// reutilizável por toda Server Action a partir de agora — nenhuma Server
// Action deve reimplementar esta checagem localmente.
//
// Sessão inválida, usuário desativado/removido ou conta com pagamento
// pendente são tratados da mesma forma: redireciona para /login (nunca
// deixa a Server Action seguir com um usuário não autenticado/autorizado).
export async function exigirUsuarioAutenticado() {
  const sessao = await auth.api.getSession({ headers: await headers() });

  if (!sessao) {
    redirect("/login");
  }

  const usuarioSessao = sessao.user as unknown as UsuarioSessao;
  const usuario = await buscarUsuarioAutenticado(
    usuarioSessao.id,
    usuarioSessao.contaId,
  );

  if (!usuario || usuario.status !== "Ativo" || usuario.conta.status !== "Ativa") {
    await auth.api.signOut({ headers: await headers() }).catch(() => {});
    redirect("/login");
  }

  return usuario;
}

// Gate exclusivo da área segregada do operador de plataforma
// (app/(plataforma), Story 1.4, AD-13) — nunca can()/PerfilAcesso, nunca o
// enum Modulo.contas. Mesmo padrão de exigirUsuarioAutenticado() para sessão
// inválida/usuário inativo (redireciona a /login), mas com um segundo
// critério: autenticado e ativo, porém sem isPlataformaOperador, não é um
// caso de sessão inválida — é acesso negado a esta área específica,
// então redireciona para "/" em vez de derrubar a sessão.
export async function exigirOperadorDePlataforma() {
  const usuario = await exigirUsuarioAutenticado();

  if (!usuario.isPlataformaOperador) {
    redirect("/");
  }

  return usuario;
}
