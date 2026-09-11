"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { entrarAction } from "@/src/server/actions/auth";
import { estadoInicialAcaoAuth } from "@/src/server/actions/auth-estado";

function BotaoEntrar() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary login-submit" type="submit" disabled={pending}>
      {pending ? "Entrando..." : "Entrar"}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </button>
  );
}

export function LoginForm() {
  const [estado, formAction] = useActionState(entrarAction, estadoInicialAcaoAuth);

  return (
    <div className="login-form">
      <h2>Entrar na sua conta</h2>
      <p className="lede">Acesse o painel administrativo do Raiz.</p>

      {estado.error ? <div className="form-error">{estado.error}</div> : null}

      <form action={formAction}>
        <div className="field">
          <label htmlFor="li-email">E-mail corporativo</label>
          <input
            id="li-email"
            name="email"
            type="email"
            placeholder="voce@empresa.com.br"
            autoComplete="email"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="li-pass">Senha</label>
          <input
            id="li-pass"
            name="senha"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="field-row">
          <label>
            <input type="checkbox" name="manterConectado" defaultChecked />
            Manter conectado
          </label>
          <Link href="/esqueci-senha" style={{ color: "var(--pine-dark)", textDecoration: "none", fontWeight: 500 }}>
            Esqueci minha senha
          </Link>
        </div>
        <BotaoEntrar />
      </form>
      <div className="login-foot">Precisa de acesso? Fale com o administrador da sua conta.</div>
    </div>
  );
}
