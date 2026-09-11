"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { editarTipoAtivoAction } from "@/src/server/actions/tipo-ativo";
import {
  estadoInicialAcaoTipoAtivo,
  mensagemDeErro,
} from "@/src/server/actions/tipo-ativo-estado";
import type { TipoAtivoListagem } from "./tipos";

const OPCOES_STATUS: { value: string; label: string }[] = [
  { value: "Ativo", label: "Ativo" },
  { value: "Arquivado", label: "Arquivado" },
];

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

// Linha expansível de edição (UX-DR3), portada de Mockup.html
// (#edit-tipos-N, Mockup.html:755-763). "Arquivar" é só selecionar Status =
// Arquivado neste mesmo formulário e salvar — não há botão de exclusão
// separado (Boundaries da story).
export function LinhaEdicao({
  tipo,
  onFechar,
  onSucesso,
}: {
  tipo: TipoAtivoListagem;
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    editarTipoAtivoAction,
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
    <tr className="form-row" id={`edit-tipos-${tipo.id}`}>
      <td colSpan={5}>
        <div className="form-row-label">Editar tipo · {tipo.nome}</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <input type="hidden" name="tipoAtivoId" value={tipo.id} />
          <div className="inline-form">
            <div className="f">
              <label htmlFor={`et-nome-${tipo.id}`}>Nome do tipo</label>
              <input
                id={`et-nome-${tipo.id}`}
                name="nome"
                type="text"
                defaultValue={tipo.nome}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`et-descricao-${tipo.id}`}>Descrição</label>
              <input
                id={`et-descricao-${tipo.id}`}
                name="descricao"
                type="text"
                defaultValue={tipo.descricao ?? ""}
              />
            </div>
            <div className="f">
              <label htmlFor={`et-status-${tipo.id}`}>Status</label>
              <select
                id={`et-status-${tipo.id}`}
                name="status"
                required
                defaultValue={tipo.status}
              >
                {OPCOES_STATUS.map((opcao) => (
                  <option key={opcao.value} value={opcao.value}>
                    {opcao.label}
                  </option>
                ))}
              </select>
            </div>
            <Acoes onFechar={onFechar} />
          </div>
        </form>
      </td>
    </tr>
  );
}
