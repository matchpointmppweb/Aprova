"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { PALETAS, type PaletaChave } from "@/src/lib/paletas";
import { atualizarPaletaAction } from "@/src/server/actions/aparencia";
import { estadoInicialAcaoAparencia } from "@/src/server/actions/aparencia-estado";

// Mesma ordem de Mockup.html:1213-1248.
const ORDEM: PaletaChave[] = [
  "verde-floresta",
  "verde-cedro",
  "verde-noturno",
  "laguna-profunda",
  "retro-piscina",
];

// Cada cartão é o próprio botão de submit (name/value = a chave clicada) —
// um único <form>/useActionState pra grade inteira, em vez de 5 Server
// Actions distintas. useFormStatus só funciona num descendente do <form>
// (não em quem o renderiza), por isso o "pending" é lido aqui dentro.
function Cartao({
  chave,
  selecionada,
  podeEditar,
}: {
  chave: PaletaChave;
  selecionada: boolean;
  podeEditar: boolean;
}) {
  const paleta = PALETAS[chave];
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="paletaDeCores"
      value={chave}
      disabled={!podeEditar || pending}
      className={`palette-card${selecionada ? " selected" : ""}`}
    >
      <div className="palette-swatches">
        <span style={{ background: paleta.forest }} />
        <span style={{ background: paleta.forest2 }} />
        <span style={{ background: paleta.pine }} />
        <span style={{ background: paleta.sage }} />
        <span style={{ background: paleta.sagePale }} />
      </div>
      <div className="palette-card-body">
        <span className="pname">{paleta.nome}</span>
        <span className="palette-check">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </span>
      </div>
    </button>
  );
}

// Grade de paletas (Mockup.html:1213-1248), desabilitada quando
// !podeEditar (I/O Matrix: "cartões aparecem desabilitados na UI"). A UI
// desabilitada é só conveniência — atualizarPaletaAction roda can() de novo
// no servidor e recusa mesmo se chamada diretamente (Boundaries, AD-2).
// paletaAtual vem do Server Component pai (app/(dashboard)/aparencia/page.tsx)
// e é atualizada automaticamente após um submit bem-sucedido, porque a
// Server Action chama revalidatePath (o próprio roundtrip da action já
// devolve a página re-renderizada — nenhum estado local de "selecionada" é
// necessário aqui).
export function PaletaGrid({
  paletaAtual,
  podeEditar,
}: {
  paletaAtual: PaletaChave;
  podeEditar: boolean;
}) {
  const [estado, formAction] = useActionState(atualizarPaletaAction, estadoInicialAcaoAparencia);

  return (
    <div className="settings-section">
      <h3>Paleta de cores</h3>
      <p>Selecione uma paleta para aplicar em todo o painel.</p>
      {estado.error ? <div className="form-error">{estado.error}</div> : null}
      {estado.ok ? <div className="form-success">Paleta atualizada.</div> : null}
      <form action={formAction}>
        <div className="palette-grid">
          {ORDEM.map((chave) => (
            <Cartao
              key={chave}
              chave={chave}
              selecionada={chave === paletaAtual}
              podeEditar={podeEditar}
            />
          ))}
        </div>
      </form>
    </div>
  );
}
