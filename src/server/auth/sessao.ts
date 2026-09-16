import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ROTA_ESCOLHER_AMBIENTE } from "@/src/lib/rotas";
import { auth } from "@/src/server/auth";
import type { SessaoAtiva, UsuarioSessao } from "@/src/server/auth/tipos";
import { buscarIdentidadeAtiva } from "@/src/server/repositories/usuario";
import {
  limparContaAtivaDaSessao,
  resolveuAConta,
  resolverUsuarioAutenticadoPeloVinculo,
  STATUS_COM_ACESSO,
} from "@/src/server/repositories/vinculo-conta";

// Guarda de sessão única de toda rota/Server Action autenticada — nenhuma
// Server Action deve reimplementar esta checagem localmente.
//
// Story 6.2: a conta ativa e o perfil NÃO vêm mais das colunas
// `Usuario.contaId`/`Usuario.perfilAcessoId` (nem dos additionalFields do
// USUÁRIO na sessão, que as espelhavam) — vêm do VinculoConta, revalidado
// contra o banco a cada requisição (NFR6). A FORMA do retorno é
// deliberadamente a mesma de antes (`contaId`, `perfilAcessoId`, `conta`,
// `perfilAcesso`): é o que permite que nem app/(dashboard)/layout.tsx, nem
// can(), nem uma única Server Action precisassem mudar (AD-23).
//
// Story 6.4: a conta ativa da SESSÃO (`session.contaAtivaId`) entra como
// PONTEIRO para a escolha já feita — nunca como credencial. O vínculo com ela
// é revalidado contra o banco aqui, a cada requisição; se deixou de valer, o
// ponteiro é apagado e a resolução volta ao caso geral.
//
// Fail-closed, mas agora por dois caminhos distintos — e a distinção é o
// ponto da story:
//   - sem sessão, identidade inativa ou ZERO vínculos utilizáveis: nada a
//     recuperar, a sessão cai e vai para /login;
//   - MAIS DE UM vínculo utilizável sem conta ativa válida: falta escolher,
//     não falta acesso. Até a 6.3 isso fazia signOut + /login, que trancava
//     justamente quem o épico veio habilitar; agora redireciona para a tela de
//     seleção, que é o caminho de recuperação correto.
//
// Nunca se escolhe um vínculo arbitrariamente.
export async function exigirUsuarioAutenticado() {
  const cabecalhos = await headers();
  const sessao = await auth.api.getSession({ headers: cabecalhos });

  if (!sessao) {
    redirect("/login");
  }

  const usuarioSessao = sessao.user as unknown as UsuarioSessao;
  const sessaoAtiva = sessao.session as unknown as SessaoAtiva;
  const contaAtivaId = sessaoAtiva.contaAtivaId ?? null;

  const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
    usuarioSessao.id,
    STATUS_COM_ACESSO,
    contaAtivaId,
  );

  // Conta ativa que não resolveu mais (vínculo desativado/removido, conta
  // suspensa): o ponteiro morto é apagado da sessão — sem isso a pessoa
  // voltaria à seleção a cada requisição, e a escolha nova conviveria com o
  // ponteiro antigo.
  //
  // E daqui NUNCA se deriva, nem quando resta exatamente UMA outra conta
  // utilizável: trocar de tenant no meio da sessão sem avisar é pior do que
  // pedir uma escolha — a pessoa agiria na conta errada achando que segue na
  // anterior. Quem tinha conta ativa e a perdeu volta à seleção; só cai no
  // login quando não sobra ambiente nenhum.
  if (contaAtivaId && !resolveuAConta(resolucao, contaAtivaId)) {
    try {
      await limparContaAtivaDaSessao(sessaoAtiva.id, usuarioSessao.id);
    } catch {
      // A limpeza é a ÚNICA coisa que impede o laço "/" -> seleção -> "/":
      // com o ponteiro morto ainda gravado, os dois redirecionamentos se
      // perseguem. Falhou, encerra a sessão — /login é o único destino que
      // não depende do estado que não conseguimos corrigir.
      await auth.api.signOut({ headers: cabecalhos }).catch(() => {});
      redirect("/login");
    }

    if (resolucao.tipo === "sem-ambiente") {
      await auth.api.signOut({ headers: cabecalhos }).catch(() => {});
      redirect("/login");
    }

    redirect(ROTA_ESCOLHER_AMBIENTE);
  }

  if (resolucao.tipo === "ambiguo") {
    redirect(ROTA_ESCOLHER_AMBIENTE);
  }

  if (resolucao.tipo === "sem-ambiente") {
    await auth.api.signOut({ headers: cabecalhos }).catch(() => {});
    redirect("/login");
  }

  return resolucao.usuario;
}

// Gate exclusivo da área segregada do operador de plataforma
// (app/(plataforma), Story 1.4, AD-13) — nunca can()/PerfilAcesso, nunca o
// enum Modulo.contas.
//
// Story 6.4: deixou de passar por exigirUsuarioAutenticado(). O papel de
// operador é da IDENTIDADE e a área de Contas é precisamente a que não
// pertence a conta nenhuma — exigir vínculo único ou conta ativa ali tirava a
// área de quem tem dois vínculos (e de quem não tem nenhum), que é o oposto do
// que o AD-13 diz. O que continua sendo exigido, e revalidado contra o banco a
// cada requisição (NFR6), é: sessão válida, identidade Ativa e
// `isPlataformaOperador`.
//
// MUDANÇA DE CONTRATO na 6.4: o retorno deixou de ser o objeto composto
// (identidade + `contaId`/`perfilAcessoId` + `conta` + `perfilAcesso`) e passou
// a ser a IDENTIDADE pura — porque é só isso que existe quando o papel não
// depende de tenant. Quem chamar isto não tem mais `usuario.conta` nem
// `usuario.perfilAcesso`: nesta área eles não teriam significado (qual conta
// seria?). Hoje o único chamador é app/(plataforma)/layout.tsx, que usa
// `nome`; qualquer novo uso que precise de conta/perfil está na área errada.
//
// Autenticado e ativo, porém sem o flag, não é sessão inválida — é acesso
// negado a esta área específica, então redireciona para "/" em vez de derrubar
// a sessão.
export async function exigirOperadorDePlataforma() {
  const cabecalhos = await headers();
  const sessao = await auth.api.getSession({ headers: cabecalhos });

  if (!sessao) {
    redirect("/login");
  }

  const usuarioSessao = sessao.user as unknown as UsuarioSessao;
  const identidade = await buscarIdentidadeAtiva(usuarioSessao.id);

  if (!identidade) {
    await auth.api.signOut({ headers: cabecalhos }).catch(() => {});
    redirect("/login");
  }

  if (!identidade.isPlataformaOperador) {
    redirect("/");
  }

  return identidade;
}
