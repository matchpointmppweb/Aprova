"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  ativarUsuarioConvidado,
  registrarUltimoAcesso,
} from "@/src/server/repositories/usuario";
import {
  definirContaAtivaDaSessao,
  resolveuAConta,
  resolverUsuarioAutenticadoPeloVinculo,
  STATUS_COM_LOGIN,
  type UsuarioResolvidoPeloVinculo,
} from "@/src/server/repositories/vinculo-conta";
import { ROTA_CONTAS_PLATAFORMA, ROTA_ESCOLHER_AMBIENTE } from "@/src/lib/rotas";
import { auth } from "@/src/server/auth";
import type { SessaoAtiva, UsuarioSessao } from "@/src/server/auth/tipos";
import type { EstadoAcaoAuth } from "./auth-estado";

const ERRO_CREDENCIAIS_INVALIDAS = "E-mail ou senha inválidos.";

// Story 6.4 (FR22): esta mensagem só aparece DEPOIS da senha correta. Ela
// confirma, a quem já provou saber a senha, que a identidade existe — e isso
// não é enumeração por terceiros: a recusa por credencial errada continua
// sendo ERRO_CREDENCIAIS_INVALIDAS, genérica e indistinguível. Antes da 6.4 os
// dois casos devolviam a mesma coisa, e quem ficava sem ambiente não tinha
// como saber se o problema era a senha ou o acesso.
const ERRO_SEM_AMBIENTE =
  "Nenhum ambiente disponível para este acesso. Fale com o administrador da sua conta.";

const ERRO_ESCOLHA_INVALIDA =
  "Escolha inválida. Selecione um dos ambientes disponíveis.";

const ERRO_PRIMEIRO_ACESSO =
  "Não foi possível concluir seu primeiro acesso. Tente novamente.";

// Passos finais comuns à entrada direta (um vínculo) e à entrada após escolha
// (vários vínculos): promover o convidado, se for o caso, e registrar o último
// acesso. Devolve `null` quando tudo correu bem, ou o estado de erro a
// devolver ao formulário — a sessão já foi revogada nesse caso.
//
// Given um usuário com status "Convite pendente" que já definiu sua senha via
// link, when faz login pela primeira vez -> status muda para "Ativo"
// automaticamente. Se a promoção falhar, não redireciona para "/": o guard de
// app/(dashboard)/layout.tsx exige status "Ativo" e mandaria o usuário de
// volta para /login sem explicação nenhuma. Melhor devolver um erro claro e
// desfazer a sessão recém criada.
//
// Story 6.2: a condição olha identidade E vínculo. A guarda de sessão exige
// `Ativo` nos dois lados; se só o vínculo estivesse ConvitePendente, o login
// passaria, a promoção seria pulada e a requisição seguinte expulsaria o
// usuário para /login sem explicação nenhuma.
//
// Story 6.4: a promoção é do vínculo ESCOLHIDO, e por isso passou a acontecer
// aqui — com dois vínculos, no momento do login ainda não se sabe qual conta é
// a da pessoa, e promover antes da escolha ativaria um vínculo que ela talvez
// nem fosse usar.
async function concluirEntrada(
  usuario: UsuarioResolvidoPeloVinculo,
): Promise<EstadoAcaoAuth | null> {
  if (
    usuario.status === "ConvitePendente" ||
    usuario.statusDoVinculo === "ConvitePendente"
  ) {
    try {
      // count 0 significa que a pessoa NÃO terminou a chamada podendo entrar:
      // sem vínculo com esta conta, ou desativada (identidade ou vínculo)
      // entre a leitura e a escrita do compare-and-set. Seguir para "/"
      // deixaria o usuário não promovido bater na guarda de sessão — mesma
      // falha que o catch abaixo já trata.
      const { count } = await ativarUsuarioConvidado(usuario.id, usuario.contaId);
      if (count === 0) {
        throw new Error("promoção de convidado não afetou nenhuma linha");
      }
    } catch {
      await auth.api.signOut({ headers: await headers() }).catch(() => {});
      return { ok: false, error: ERRO_PRIMEIRO_ACESSO };
    }
  }

  // Falha ao registrar o último acesso não deve barrar o login.
  // Story 6.3: `ultimoAcesso` é da identidade, sem recorte por conta — a
  // função deixou de receber `contaId`.
  await registrarUltimoAcesso(usuario.id).catch(() => {});

  return null;
}

// Given e-mail ou senha errados -> mensagem de erro genérica (Boundaries:
// "mensagens de erro de login/reset nunca revelam se o e-mail existe").
export async function entrarAction(
  _estadoAnterior: EstadoAcaoAuth,
  formData: FormData,
): Promise<EstadoAcaoAuth> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const senha = String(formData.get("senha") ?? "");
  const manterConectado = formData.get("manterConectado") === "on";

  if (!email || !senha) {
    return { ok: false, error: "Informe e-mail e senha." };
  }

  let usuarioSessao: UsuarioSessao | null = null;
  try {
    const resultado = await auth.api.signInEmail({
      body: { email, password: senha, rememberMe: manterConectado },
    });
    usuarioSessao = resultado.user as unknown as UsuarioSessao;
  } catch {
    return { ok: false, error: ERRO_CREDENCIAIS_INVALIDAS };
  }

  // Usuario.status/Conta.status não são checados pelo Better Auth — um
  // usuário Inativo ou uma conta com pagamento pendente não autentica,
  // mesmo com senha correta. Um usuário ConvitePendente autentica
  // normalmente (só chega aqui se já definiu senha via link de convite —
  // signInEmail já validou a senha acima) e é promovido a Ativo abaixo. A
  // sessão já foi criada em signInEmail, então revogamos antes de recusar.
  //
  // Story 6.2: a conta do login é resolvida pelo vínculo (identidade +
  // vínculo com status que permita login + Conta Ativa, tudo no mesmo
  // `where`), exatamente como a guarda de sessão.
  //
  // Story 6.4: os três desfechos passam a ser distintos — entrar direto (um
  // vínculo), escolher (vários) ou recusar por ambiente indisponível (zero).
  // Nenhuma conta ativa é passada aqui: a sessão acabou de nascer, e quem tem
  // um vínculo só nunca precisa de nada gravado.
  const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
    usuarioSessao.id,
    STATUS_COM_LOGIN,
  );

  if (resolucao.tipo === "sem-ambiente") {
    // O operador de plataforma é a exceção, e é o ponto do AD-13: o papel é da
    // IDENTIDADE e a área de Contas não pertence a conta nenhuma. Derrubar a
    // sessão aqui deixaria um operador sem vínculo permanentemente fora do
    // sistema — anulando justamente o motivo de exigirOperadorDePlataforma()
    // ter deixado de exigir vínculo. A sessão fica de pé e ele vai para a área
    // dele; o flag é revalidado contra o banco lá, pelo gate.
    if (usuarioSessao.isPlataformaOperador) {
      redirect(ROTA_CONTAS_PLATAFORMA);
    }

    await auth.api.signOut({ headers: await headers() }).catch(() => {});
    return { ok: false, error: ERRO_SEM_AMBIENTE };
  }

  // Mais de um vínculo utilizável: a sessão fica de pé (sem conta ativa) e a
  // escolha acontece na tela intermediária. Nada é escolhido aqui — nem a
  // promoção de convidado nem o registro de acesso acontecem antes de a pessoa
  // dizer em qual ambiente está entrando.
  if (resolucao.tipo === "ambiguo") {
    redirect(ROTA_ESCOLHER_AMBIENTE);
  }

  const erro = await concluirEntrada(resolucao.usuario);
  if (erro) {
    return erro;
  }

  redirect("/");
}

// Escolha do ambiente na tela intermediária (Story 6.4, FR22). O `contaId`
// submetido é palpite do cliente até esta action revalidá-lo contra o banco
// (NFR2): a página oferece opções, mas quem decide é
// resolverUsuarioAutenticadoPeloVinculo, que exige vínculo utilizável daquela
// identidade com aquela conta e conta Ativa. Escolha forjada não grava nada.
export async function escolherAmbienteAction(
  _estadoAnterior: EstadoAcaoAuth,
  formData: FormData,
): Promise<EstadoAcaoAuth> {
  const contaId = String(formData.get("contaId") ?? "").trim();

  if (!contaId) {
    return { ok: false, error: ERRO_ESCOLHA_INVALIDA };
  }

  const cabecalhos = await headers();
  const sessao = await auth.api.getSession({ headers: cabecalhos });

  if (!sessao) {
    redirect("/login");
  }

  const usuarioSessao = sessao.user as unknown as UsuarioSessao;
  const sessaoAtiva = sessao.session as unknown as SessaoAtiva;

  // Uma conta ativa VÁLIDA já gravada não é sobrescrita por esta action: trocar
  // de conta com a sessão estabelecida é a Story 6.5, e aceitar aqui um
  // `contaId` de outra conta implementaria a troca por acidente — inclusive
  // para quem forjasse o POST. Esta action só CONCLUI o login.
  if (sessaoAtiva.contaAtivaId) {
    const jaEscolhida = await resolverUsuarioAutenticadoPeloVinculo(
      usuarioSessao.id,
      STATUS_COM_LOGIN,
      sessaoAtiva.contaAtivaId,
    );
    if (resolveuAConta(jaEscolhida, sessaoAtiva.contaAtivaId)) {
      redirect("/");
    }
  }

  const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
    usuarioSessao.id,
    STATUS_COM_LOGIN,
    contaId,
  );

  // Não basta ter resolvido ALGO: sem vínculo com a conta pedida a resolução
  // cai na contagem e pode devolver outra conta. `resolveuAConta` é a mesma
  // pergunta que a guarda e a página fazem.
  if (!resolveuAConta(resolucao, contaId)) {
    return { ok: false, error: ERRO_ESCOLHA_INVALIDA };
  }

  // A promoção do convidado vem ANTES da gravação: se ela falhar, a sessão é
  // revogada por concluirEntrada e nada fica apontando para um vínculo não
  // promovido — o que faria a guarda expulsar a pessoa sem explicação na
  // requisição seguinte.
  const erro = await concluirEntrada(resolucao.usuario);
  if (erro) {
    return erro;
  }

  // count 0: a sessão sumiu ou foi rotacionada entre a leitura e esta escrita —
  // exatamente o caso para o qual o `where` foi endurecido. Seguir para "/"
  // faria a guarda ver sessão sem conta ativa e devolver à seleção, num laço
  // sem mensagem nenhuma. Mesmo compare-and-set dos demais desta story.
  const { count } = await definirContaAtivaDaSessao(
    sessaoAtiva.id,
    usuarioSessao.id,
    contaId,
  );
  if (count === 0) {
    return { ok: false, error: ERRO_ESCOLHA_INVALIDA };
  }

  redirect("/");
}

// Given e-mail existente ou não -> mesma resposta de sucesso na tela (sem
// enumeration); o próprio Better Auth já responde de forma indistinguível
// nos dois casos.
export async function solicitarResetSenhaAction(
  _estadoAnterior: EstadoAcaoAuth,
  formData: FormData,
): Promise<EstadoAcaoAuth> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return { ok: false, error: "Informe seu e-mail." };
  }

  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/redefinir-senha" },
    });
  } catch {
    // Ignorado de propósito: a resposta ao usuário é sempre a mesma,
    // exista o e-mail ou não.
  }

  return {
    ok: true,
    message:
      "Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha.",
  };
}

export async function redefinirSenhaAction(
  _estadoAnterior: EstadoAcaoAuth,
  formData: FormData,
): Promise<EstadoAcaoAuth> {
  const token = String(formData.get("token") ?? "");
  const novaSenha = String(formData.get("novaSenha") ?? "");
  const confirmarSenha = String(formData.get("confirmarSenha") ?? "");

  if (!token) {
    return {
      ok: false,
      error: "Link de redefinição inválido ou expirado. Solicite um novo.",
    };
  }
  if (novaSenha.length < 8) {
    return { ok: false, error: "A senha deve ter pelo menos 8 caracteres." };
  }
  if (novaSenha !== confirmarSenha) {
    return { ok: false, error: "As senhas não coincidem." };
  }

  try {
    await auth.api.resetPassword({ body: { newPassword: novaSenha, token } });
  } catch {
    // Nunca expõe detalhe interno/stack (Boundaries) — mensagem genérica.
    return {
      ok: false,
      error:
        "Não foi possível redefinir sua senha. O link pode ter expirado — solicite um novo.",
    };
  }

  return {
    ok: true,
    message: "Senha redefinida com sucesso. Você já pode entrar com a nova senha.",
  };
}

export async function sairAction() {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // Sessão já pode estar expirada/inválida — mesmo assim, sempre manda
    // de volta para o login.
  }
  redirect("/login");
}
