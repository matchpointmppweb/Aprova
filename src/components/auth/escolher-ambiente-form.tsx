"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { escolherAmbienteAction, sairAction } from "@/src/server/actions/auth";
import { estadoInicialAcaoAuth } from "@/src/server/actions/auth-estado";

export type OpcaoDeAmbiente = {
  contaId: string;
  contaNome: string;
  perfilNome: string;
};

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

// Tela de escolha de ambiente (Story 6.4). Estrutura idêntica à do login
// (`login-form.tsx`): um campo em `.field` e o mesmo botão primário — é a mesma
// etapa do mesmo fluxo, e a pessoa acabou de sair da tela anterior.
//
// Era uma grade de cartões; virou menu suspenso a pedido do Fulvi, depois de
// ver as duas contas empilhadas em caixas. Além da aparência, o suspenso é o
// que escala: uma identidade que atenda uma dúzia de contas empurraria o botão
// para fora da tela com cartões.
//
// O que NÃO mudou é a regra da story: nunca prosseguir sem escolher, e nunca
// escolher pela pessoa. Por isso a primeira opção é um placeholder
// `disabled`/`value=""` e o `<select>` é `required` — sem isso, o navegador
// pré-seleciona a primeira conta e um "Entrar" distraído entraria num ambiente
// que ninguém escolheu, que é exatamente o que o FR22 existe para impedir.
//
// "Sair" continua existindo porque encerrar a sessão não é prosseguir — é o
// caminho de quem entrou com a identidade errada.
export function EscolherAmbienteForm({ opcoes }: { opcoes: OpcaoDeAmbiente[] }) {
  // O terceiro retorno (`pendente`) é o envio do form de ESCOLHA, lido aqui
  // fora dele para desabilitar o "Sair" — que vive em outro <form> e, por isso,
  // não enxerga aquele envio por useFormStatus.
  const [estado, formAction, pendente] = useActionState(
    escolherAmbienteAction,
    estadoInicialAcaoAuth,
  );

  return (
    <div className="login-form">
      <h2>Escolha o ambiente</h2>
      <p className="lede">
        Seu acesso atende mais de uma conta. Selecione em qual delas você quer
        entrar agora.
      </p>

      {estado.error ? (
        <div className="form-error" role="alert">
          {estado.error}
        </div>
      ) : null}

      <form action={formAction}>
        <div className="field">
          <label htmlFor="ea-conta">Conta</label>
          <select id="ea-conta" name="contaId" defaultValue="" required>
            <option value="" disabled>
              Selecione uma conta...
            </option>
            {opcoes.map((opcao) => (
              // UX-DR12: nome da conta E perfil da pessoa NAQUELA conta — o
              // perfil é o que distingue duas linhas quando os nomes das contas
              // se parecem, e é o que muda o que ela poderá fazer ao entrar.
              <option key={opcao.contaId} value={opcao.contaId}>
                {opcao.contaNome} — {opcao.perfilNome}
              </option>
            ))}
          </select>
        </div>

        <BotaoEntrar />
      </form>

      <div className="login-foot">
        <form action={sairAction}>
          <button
            type="submit"
            disabled={pendente}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
              color: "var(--pine-dark)",
              fontWeight: 500,
              cursor: pendente ? "not-allowed" : "pointer",
              opacity: pendente ? 0.5 : 1,
            }}
          >
            Sair e entrar com outro acesso
          </button>
        </form>
      </div>
    </div>
  );
}
