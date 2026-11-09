"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { solicitarResetSenhaAction } from "@/src/server/actions/auth";
import { estadoInicialAcaoAuth } from "@/src/server/actions/auth-estado";
import { LIMITE_NOME } from "@/src/lib/texto";

// Separado por causa do `useFormStatus`, que lê o <form> ANCESTRAL — mesmo
// motivo de BotaoEntrar em login-form.tsx.
function BotaoEnviar() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary login-submit" type="submit" disabled={pending}>
      {pending ? "Enviando..." : "Enviar link de redefinição"}
    </button>
  );
}

// Solicitação de redefinição de senha.
//
// O que é preciso saber antes de mexer aqui: a action responde SEMPRE a mesma
// coisa — `ok` com a mensagem "Se este e-mail estiver cadastrado..." —, exista
// o e-mail ou não, e mesmo quando o limite de solicitações já estourou. É
// deliberado: qualquer resposta que diferencie os casos transformaria este
// formulário num verificador de quais e-mails estão cadastrados (NFR2).
//
// Por isso o texto de apoio diz "Se ele estiver cadastrado" em vez de prometer
// o envio, e por isso não existe aqui nenhum tratamento de "e-mail não
// encontrado": esse estado não chega, e não deve chegar.
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

      {estado.error ? <div className="form-error" role="alert">{estado.error}</div> : null}
      {estado.ok && estado.message ? (
        <div className="form-success">{estado.message}</div>
      ) : null}

      {/* O formulário SOME depois do sucesso, em vez de ficar disponível para
          reenvio. Como a resposta não diz se o e-mail existe, reenviar não
          traria informação nova — só gastaria a cota de recuperação, que é
          apertada de propósito (uma solicitação dispara um e-mail de verdade). */}
      {!estado.ok || !estado.message ? (
        <form action={formAction}>
          <div className="field">
            <label htmlFor="fp-email">E-mail corporativo</label>
            <input
              id="fp-email"
              name="email"
              maxLength={LIMITE_NOME}
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
