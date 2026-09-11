"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { redefinirSenhaAction } from "@/src/server/actions/auth";
import { estadoInicialAcaoAuth } from "@/src/server/actions/auth-estado";

function BotaoRedefinir() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary login-submit" type="submit" disabled={pending}>
      {pending ? "Salvando..." : "Redefinir senha"}
    </button>
  );
}

export function RedefinirSenhaForm({ token }: { token: string }) {
  const [estado, formAction] = useActionState(
    redefinirSenhaAction,
    estadoInicialAcaoAuth,
  );

  return (
    <div className="login-form">
      <h2>Redefinir senha</h2>
      <p className="lede">Escolha uma nova senha para sua conta.</p>

      {estado.error ? <div className="form-error">{estado.error}</div> : null}
      {estado.ok && estado.message ? (
        <div className="form-success">{estado.message}</div>
      ) : null}

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
