"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { solicitarResetSenhaAction } from "@/src/server/actions/auth";
import { estadoInicialAcaoAuth } from "@/src/server/actions/auth-estado";

function BotaoEnviar() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary login-submit" type="submit" disabled={pending}>
      {pending ? "Enviando..." : "Enviar link de redefinição"}
    </button>
  );
}

export function EsqueciSenhaForm() {
  const [estado, formAction] = useActionState(
    solicitarResetSenhaAction,
    estadoInicialAcaoAuth,
  );

  return (
    <div className="login-form">
      <h2>Esqueci minha senha</h2>
      <p className="lede">
        Informe seu e-mail corporativo. Se ele estiver cadastrado, enviaremos um
        link para redefinir sua senha.
      </p>

      {estado.error ? <div className="form-error">{estado.error}</div> : null}
      {estado.ok && estado.message ? (
        <div className="form-success">{estado.message}</div>
      ) : null}

      {!estado.ok || !estado.message ? (
        <form action={formAction}>
          <div className="field">
            <label htmlFor="fp-email">E-mail corporativo</label>
            <input
              id="fp-email"
              name="email"
              type="email"
              placeholder="voce@empresa.com.br"
              autoComplete="email"
              required
            />
          </div>
          <BotaoEnviar />
        </form>
      ) : null}

      <div className="login-foot">
        <Link href="/login" style={{ color: "var(--pine-dark)", textDecoration: "none", fontWeight: 500 }}>
          Voltar para o login
        </Link>
      </div>
    </div>
  );
}
