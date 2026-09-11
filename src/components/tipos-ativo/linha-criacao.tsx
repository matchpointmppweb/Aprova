"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { criarTipoAtivoAction } from "@/src/server/actions/tipo-ativo";
import {
  estadoInicialAcaoTipoAtivo,
  mensagemDeErro,
} from "@/src/server/actions/tipo-ativo-estado";

// useFormStatus só funciona num componente descendente do <form> (não no
// que o renderiza) — por isso Salvar e Cancelar são agrupados aqui: o
// Cancelar também precisa ficar desabilitado durante o submit, senão dá pra
// clicar nele, desmontar a linha e perder a visibilidade do resultado do
// save em andamento.
function Acoes({ onFechar }: { onFechar: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="actions">
      <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar"}
      </button>
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={onFechar}
        disabled={pending}
      >
        Cancelar
      </button>
    </div>
  );
}

// Linha expansível de criação (UX-DR3), portada de Mockup.html
// (#create-tipos, Mockup.html:744-752).
export function LinhaCriacao({
  onFechar,
  onSucesso,
}: {
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    criarTipoAtivoAction,
    estadoInicialAcaoTipoAtivo,
  );

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id="create-tipos">
      <td colSpan={5}>
        <div className="form-row-label">Novo tipo</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <div className="inline-form">
            <div className="f">
              <label htmlFor="ct-nome">Nome do tipo</label>
              <input
                id="ct-nome"
                name="nome"
                type="text"
                placeholder="Ex.: Instrumento de medição"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="ct-descricao">Descrição</label>
              <input
                id="ct-descricao"
                name="descricao"
                type="text"
                placeholder="Descreva brevemente esse tipo"
              />
            </div>
            <div className="f">
              <label htmlFor="ct-status">Status</label>
              <select id="ct-status" name="status" required defaultValue="Ativo">
                <option value="Ativo">Ativo</option>
                <option value="Arquivado">Arquivado</option>
              </select>
            </div>
            <Acoes onFechar={onFechar} />
          </div>
        </form>
      </td>
    </tr>
  );
}
