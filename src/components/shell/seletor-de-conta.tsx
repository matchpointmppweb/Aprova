"use client";

import { useActionState } from "react";

import { trocarDeContaAction } from "@/src/server/actions/auth";
import { estadoInicialAcaoAuth } from "@/src/server/actions/auth-estado";
import type { OpcaoDeAmbiente } from "@/src/components/auth/escolher-ambiente-form";

// Seletor de conta da topbar (Story 6.5, FR23/UX-DR13). É Client Component
// porque a troca tem estado de erro a mostrar (escolha recusada pela
// revalidação) — o botão de sair, que não tem desfecho a comunicar, continua
// sendo o `<form action={...}>` puro ao lado.
//
// `<select>` e não uma grade de cartões como a tela de seleção da 6.4: ali a
// escolha é o conteúdo da página inteira; aqui ela divide 58px de topbar com
// busca, notificações e o bloco de usuário. As classes são as que já existem em
// globals.css (AD-4, UX-DR1) — `status-select` é o select da barra de filtros —
// com sobreposições inline de tamanho E DE COR para caber na topbar escura,
// reusando os valores que `.topbar-search` já aplica ali. Nenhuma classe nova,
// nenhuma biblioteca de UI.
//
// Quem renderiza isto (`Topbar`) é quem decide se ele existe: com um único
// ambiente escolhível a topbar fica exatamente como era.
export function SeletorDeConta({
  opcoes,
  contaAtivaId,
}: {
  opcoes: OpcaoDeAmbiente[];
  contaAtivaId: string;
}) {
  const [estado, formAction, pendente] = useActionState(
    trocarDeContaAction,
    estadoInicialAcaoAuth,
  );

  return (
    <form action={formAction} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* Sem botão "trocar": a escolha É o envio, como na grade de paletas e na
          tela de seleção da 6.4. `requestSubmit` (e não `submit`) para que o
          React intercepte o envio da Server Action. */}
      <select
        // CONTROLADO por `contaAtivaId`, e é o ponto todo: o select nunca exibe
        // uma conta que a pessoa apenas TENTOU escolher. Quem escolhe propõe; o
        // valor só muda quando a troca é aceita e o layout re-renderiza com a
        // conta ativa nova. Recusada, o React repõe a conta anterior sozinho —
        // inclusive na segunda recusa seguida, que é onde uma `key` derivada da
        // mensagem de erro (sempre a mesma string) falharia em silêncio.
        name="contaId"
        aria-label="Conta ativa"
        value={contaAtivaId}
        disabled={pendente}
        onChange={(evento) => evento.currentTarget.form?.requestSubmit()}
        className="status-select"
        style={{
          padding: "5px 9px",
          fontSize: 12,
          maxWidth: 200,
          cursor: pendente ? "not-allowed" : "pointer",
          opacity: pendente ? 0.5 : 1,
          // `status-select` nasceu para a barra de filtros CLARA (fundo branco,
          // borda clara). Na topbar verde-escura isso vira uma caixa branca
          // destoando de tudo em volta, então as cores seguem o padrão que a
          // própria topbar já usa em `.topbar-search`: branco translúcido sobre
          // o verde. `color-scheme: dark` é o que faz o navegador desenhar a
          // seta do <select> e o menu suspenso nativo em tom escuro também —
          // sem isso, o menu abre claro e o contraste se inverte.
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.12)",
          color: "#fff",
          colorScheme: "dark",
        }}
      >
        {opcoes.map((opcao) => (
          // UX-DR12, como na tela de seleção: o perfil desambigua duas contas
          // de nome parecido e é o que muda o que a pessoa poderá fazer lá.
          <option key={opcao.contaId} value={opcao.contaId}>
            {opcao.contaNome} — {opcao.perfilNome}
          </option>
        ))}
      </select>

      {/* `role="alert"`: a recusa deixa a topbar visualmente igual (o select
          volta à conta anterior), então sem o anúncio quem usa leitor de tela
          não recebe retorno nenhum. */}
      {estado.error ? (
        <span
          className="form-error"
          role="alert"
          style={{ margin: 0, padding: "4px 8px", fontSize: 11.5, maxWidth: 220 }}
        >
          {estado.error}
        </span>
      ) : null}
    </form>
  );
}
