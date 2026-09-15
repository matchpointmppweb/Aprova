"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { criarCargoAction } from "@/src/server/actions/cargo";
import {
  estadoInicialAcaoCargo,
  mensagemDeErro,
} from "@/src/server/actions/cargo-estado";

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

// Linha expansível de criação (UX-DR3), portada de Mockups/Mochup_atual.html
// (#create-cargos, linhas 1211-1219). Um único campo de texto (`descricao`)
// além de Status, sem Nome separado (Boundaries da story).
export function LinhaCriacao({
  onFechar,
  onSucesso,
}: {
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    criarCargoAction,
    estadoInicialAcaoCargo,
  );

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id="create-cargos">
      <td colSpan={3}>
        <div className="form-row-label">Novo cargo</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <div className="inline-form">
            <div className="f">
              <label htmlFor="cc-descricao">Descrição</label>
              <input
                id="cc-descricao"
                name="descricao"
                type="text"
                placeholder="Ex.: Supervisor de operações"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="cc-status">Status</label>
              <select id="cc-status" name="status" required defaultValue="Ativo">
                <option value="Ativo">Ativo</option>
                <option value="Inativo">Inativo</option>
              </select>
            </div>
            <Acoes onFechar={onFechar} />
          </div>
        </form>
      </td>
    </tr>
  );
}
