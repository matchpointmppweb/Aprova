"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { editarFuncaoAction } from "@/src/server/actions/funcao";
import {
  estadoInicialAcaoFuncao,
  mensagemDeErro,
} from "@/src/server/actions/funcao-estado";
import type { FuncaoListagem } from "./tipos";

const OPCOES_STATUS: { value: string; label: string }[] = [
  { value: "Ativo", label: "Ativo" },
  { value: "Inativo", label: "Inativo" },
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

// Linha expansível de edição (UX-DR3), portada de Mockups/Mochup_atual.html
// (#edit-funcoes-N, linhas 1293-1301). "Inativar" é só selecionar Status =
// Inativo neste mesmo formulário e salvar — não há botão de exclusão
// separado (Boundaries da story).
export function LinhaEdicao({
  funcao,
  onFechar,
  onSucesso,
}: {
  funcao: FuncaoListagem;
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    editarFuncaoAction,
    estadoInicialAcaoFuncao,
  );

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id={`edit-funcoes-${funcao.id}`}>
      <td colSpan={3}>
        <div className="form-row-label">Editar função · {funcao.descricao}</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <input type="hidden" name="funcaoId" value={funcao.id} />
          <div className="inline-form">
            <div className="f">
              <label htmlFor={`ef-descricao-${funcao.id}`}>Descrição</label>
              <input
                id={`ef-descricao-${funcao.id}`}
                name="descricao"
                type="text"
                defaultValue={funcao.descricao}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ef-status-${funcao.id}`}>Status</label>
              <select
                id={`ef-status-${funcao.id}`}
                name="status"
                required
                defaultValue={funcao.status}
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
