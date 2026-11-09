"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { redefinirSenhaAction } from "@/src/server/actions/auth";
import { estadoInicialAcaoAuth } from "@/src/server/actions/auth-estado";

// Separado por causa do `useFormStatus` — mesmo motivo de BotaoEntrar em
// login-form.tsx.
function BotaoRedefinir() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary login-submit" type="submit" disabled={pending}>
      {pending ? "Salvando..." : "Redefinir senha"}
    </button>
  );
}

// Troca efetiva da senha, a partir do token que veio no link do e-mail.
//
// O `token` chega como prop (a página o lê da URL) e viaja num campo oculto.
// É ele, e não a sessão, que autoriza a troca: quem redefine senha
// justamente não está autenticado.
//
// A confirmação da senha é conferida NO SERVIDOR, não aqui. O `minLength` dos
// dois campos poupa a viagem inútil, mas não é a validação — quem recusa é a
// action, e é lá que o par "nova" x "confirmar" é comparado. Validar só no
// cliente deixaria a regra contornável por quem enviasse o formulário direto.
export function RedefinirSenhaForm({ token }: { token: string }) {
  const [estado, formAction] = useActionState(
    redefinirSenhaAction,
    estadoInicialAcaoAuth,
  );

  return (
    <div className="login-form">
      <h2>Redefinir senha</h2>
      <p className="lede">Escolha uma nova senha para sua conta.</p>

      {estado.error ? <div className="form-error" role="alert">{estado.error}</div> : null}
      {estado.ok && estado.message ? (
        <div className="form-success">{estado.message}</div>
      ) : null}

      {/* Depois do sucesso o formulário é trocado por um link para o login, e
          não por um redirecionamento automático: a pessoa precisa ler a
          confirmação de que a senha mudou antes de ser levada embora. */}
      {!estado.ok ? (
        <form action={formAction}>
          <input type="hidden" name="token" value={token} />
          <div className="field">
            <label htmlFor="rp-nova">Nova senha</label>
            <input
              id="rp-nova"
              name="novaSenha"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="rp-confirmar">Confirmar nova senha</label>
            <input
              id="rp-confirmar"
              name="confirmarSenha"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <BotaoRedefinir />
        </form>
      ) : (
        <Link href="/login" className="btn btn-primary login-submit" style={{ textDecoration: "none" }}>
          Ir para o login
        </Link>
      )}
    </div>
  );
}
