"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  ativarUsuarioConvidado,
  registrarUltimoAcesso,
} from "@/src/server/repositories/usuario";
import {
  resolverUsuarioAutenticadoPeloVinculo,
  STATUS_COM_LOGIN,
} from "@/src/server/repositories/vinculo-conta";
import { auth } from "@/src/server/auth";
import type { UsuarioSessao } from "@/src/server/auth/tipos";
import type { EstadoAcaoAuth } from "./auth-estado";

const ERRO_CREDENCIAIS_INVALIDAS = "E-mail ou senha inválidos.";

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
  // `where`), exatamente como a guarda de sessão. Sem vínculo utilizável —
  // zero, ou mais de um sem escolha registrada — a recusa é a mesma mensagem
  // genérica de credenciais, sem revelar nada sobre a existência do e-mail.
  const usuario = await resolverUsuarioAutenticadoPeloVinculo(
    usuarioSessao.id,
    STATUS_COM_LOGIN,
  );
  if (!usuario) {
    await auth.api.signOut({ headers: await headers() }).catch(() => {});
    return { ok: false, error: ERRO_CREDENCIAIS_INVALIDAS };
  }

  // Given um usuário com status "Convite pendente" que já definiu sua senha
  // via link, when faz login pela primeira vez -> status muda para "Ativo"
  // automaticamente (I/O Matrix desta story). Se a promoção falhar, não
  // redireciona para "/" — o guard de app/(dashboard)/layout.tsx exige
  // status "Ativo" e mandaria o usuário de volta para /login sem explicação
  // nenhuma. Melhor devolver um erro claro aqui e desfazer a sessão recém
  // criada.
  //
  // Story 6.2: a condição olha identidade E vínculo. A guarda de sessão exige
  // `Ativo` nos dois lados; se só o vínculo estivesse ConvitePendente, o login
  // passaria, a promoção seria pulada e a requisição seguinte expulsaria o
  // usuário para /login sem explicação nenhuma.
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
      return {
        ok: false,
        error:
          "Não foi possível concluir seu primeiro acesso. Tente novamente.",
      };
    }
  }

  // Falha ao registrar o último acesso não deve barrar o login.
  // Story 6.3: `ultimoAcesso` é da identidade, sem recorte por conta — a
  // função deixou de receber `contaId`.
  await registrarUltimoAcesso(usuario.id).catch(() => {});

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
