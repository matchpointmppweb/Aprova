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

// Mesmo padrão da grade de paletas (src/components/aparencia/paleta-grid.tsx):
// um único <form>/useActionState para a grade inteira, cada cartão sendo o
// próprio botão de submit (name/value = a conta clicada), em vez de uma Server
// Action por opção. useFormStatus só funciona num DESCENDENTE do <form> (não
// em quem o renderiza), por isso o "pending" é lido aqui dentro — e vale para
// a grade toda: clicado um cartão, todos desabilitam, que é o certo num
// formulário que termina em redirect.
//
// As classes `palette-card`/`palette-card-body`/`pname` são as que já existem
// em globals.css (AD-4) — nenhuma classe nova, nenhum padrão visual novo.
function CartaoAmbiente({ opcao }: { opcao: OpcaoDeAmbiente }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="contaId"
      value={opcao.contaId}
      disabled={pending}
      className="palette-card"
      style={{ textAlign: "left" }}
    >
      <div className="palette-card-body" style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
        {/* UX-DR12: nome da conta E perfil da pessoa NAQUELA conta — o perfil
            é o que distingue duas linhas quando a pessoa atende contas com
            nomes parecidos, e é a informação que muda o que ela poderá fazer
            depois de entrar. */}
        <span className="pname">{opcao.contaNome}</span>
        <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{opcao.perfilNome}</span>
      </div>
    </button>
  );
}

// Tela de escolha de ambiente (Story 6.4). Não há botão "continuar", opção
// pré-selecionada nem link para o painel: o único caminho adiante é clicar num
// ambiente (Boundaries — nunca deixar prosseguir sem escolher, nunca escolher
// por conta própria). "Sair" existe porque encerrar a sessão não é prosseguir
// — é o caminho de quem entrou com a identidade errada.
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

      {/* `role="alert"` porque este formulário não tem botão de submit visível
          e o caminho de falha deixa a página visualmente igual: sem o anúncio,
          quem usa leitor de tela clica num cartão e não recebe retorno nenhum. */}
      {estado.error ? (
        <div className="form-error" role="alert">
          {estado.error}
        </div>
      ) : null}

      <form action={formAction}>
        {/* `palette-grid` já existe em globals.css; aqui a grade é de uma
            coluna só (o formulário do login tem 360px, e cada cartão carrega
            duas linhas de texto) — sobrescrito inline, sem classe nova. */}
        <div className="palette-grid" style={{ gridTemplateColumns: "1fr", marginBottom: 0 }}>
          {opcoes.map((opcao) => (
            <CartaoAmbiente key={opcao.contaId} opcao={opcao} />
          ))}
        </div>
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
