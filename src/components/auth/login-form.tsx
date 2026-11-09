"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { entrarAction } from "@/src/server/actions/auth";
import { estadoInicialAcaoAuth } from "@/src/server/actions/auth-estado";
import { LIMITE_NOME } from "@/src/lib/texto";

// Componente SEPARADO só por causa do `useFormStatus`: ele lê o estado do
// <form> ANCESTRAL, então um hook chamado dentro de `LoginForm` — que é quem
// renderiza o <form> — não enxergaria envio nenhum e o botão nunca
// desabilitaria. É a razão de existir esta função de cinco linhas.
//
// O `disabled` durante o envio não é só estética: sem ele, dois cliques
// rápidos disparam duas tentativas de login, e cada tentativa conta no limite
// de tentativas por e-mail (src/server/actions/auth.ts).
function BotaoEntrar() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary login-submit" type="submit" disabled={pending}>
      {pending ? "Entrando..." : "Entrar"}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </button>
  );
}

// Formulário de entrada. Toda a decisão vive no servidor
// (`entrarAction`); aqui só se exibe o que ele devolveu.
//
// A mensagem de erro é mostrada COMO VEIO, sem interpretação: o servidor
// escolhe deliberadamente uma mensagem genérica e indistinguível ("E-mail ou
// senha inválidos.") para e-mail que não existe e para senha errada, de modo a
// não revelar quais e-mails estão cadastrados (NFR2). Qualquer tentativa de
// detalhar aqui — "este e-mail não existe" — desfaria isso.
export function LoginForm() {
  const [estado, formAction] = useActionState(entrarAction, estadoInicialAcaoAuth);

  return (
    <div className="login-form">
      <h2>Entrar na sua conta</h2>
      <p className="lede">Acesse o painel administrativo do Raiz.</p>

      {/* `role="alert"` para o leitor de tela anunciar a falha sem a pessoa
          ter de ir procurar o texto — o campo não recebe foco automático
          porque o erro é da combinação, não de um campo específico. */}
      {estado.error ? (
        <div className="form-error" role="alert">
          {estado.error}
        </div>
      ) : null}

      <form action={formAction}>
        <div className="field">
          <label htmlFor="li-email">E-mail corporativo</label>
          {/* `maxLength` é o mesmo teto que o servidor aplica
              (src/lib/texto.ts): poupa a viagem inútil, mas quem recusa de
              verdade é a action — atributo de HTML é conveniência, nunca
              validação. */}
          <input
            id="li-email"
            name="email"
            maxLength={LIMITE_NOME}
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
          {/* Vira `rememberMe` do Better Auth na action. Marcado por padrão
              porque a sessão dura 7 dias e o público é interno; desmarcar
              encurta a sessão ao fechamento do navegador. */}
          <label>
            <input type="checkbox" name="manterConectado" defaultChecked />
            Manter conectado
          </label>
          <Link
            href="/esqueci-senha"
            style={{ color: "var(--pine-dark)", textDecoration: "none", fontWeight: 500 }}
          >
            Esqueci minha senha
          </Link>
        </div>
        <BotaoEntrar />
      </form>
      <div className="login-foot">Precisa de acesso? Fale com o administrador da sua conta.</div>
    </div>
  );
}
