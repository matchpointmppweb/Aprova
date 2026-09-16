import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/src/server/auth";
import type { UsuarioSessao } from "@/src/server/auth/tipos";
import {
  resolverUsuarioAutenticadoPeloVinculo,
  STATUS_COM_ACESSO,
} from "@/src/server/repositories/vinculo-conta";

// Guarda de sessão única de toda rota/Server Action autenticada — nenhuma
// Server Action deve reimplementar esta checagem localmente.
//
// Story 6.2: a conta ativa e o perfil NÃO vêm mais das colunas
// `Usuario.contaId`/`Usuario.perfilAcessoId` (nem dos additionalFields da
// sessão, que as espelham) — vêm do VinculoConta, revalidado contra o banco a
// cada requisição (NFR6). A FORMA do retorno é deliberadamente a mesma de
// antes (`contaId`, `perfilAcessoId`, `conta`, `perfilAcesso`): é o que
// permite que nem app/(dashboard)/layout.tsx, nem can(), nem uma única Server
// Action precisassem mudar (AD-23).
//
// Fail-closed e sempre pelo mesmo caminho: sessão inválida, identidade
// inativa, vínculo inativo/removido, conta suspensa, zero vínculos ou mais de
// um vínculo ativo (sem escolha registrada — Story 6.4) derrubam a sessão e
// redirecionam para /login. Nunca se escolhe um vínculo arbitrariamente.
export async function exigirUsuarioAutenticado() {
  const sessao = await auth.api.getSession({ headers: await headers() });

  if (!sessao) {
    redirect("/login");
  }

  const usuarioSessao = sessao.user as unknown as UsuarioSessao;
  const usuario = await resolverUsuarioAutenticadoPeloVinculo(
    usuarioSessao.id,
    STATUS_COM_ACESSO,
  );

  if (!usuario) {
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
