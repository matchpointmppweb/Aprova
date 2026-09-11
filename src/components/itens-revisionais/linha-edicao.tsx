"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { editarItemRevisionalAction } from "@/src/server/actions/item-revisional";
import {
  estadoInicialAcaoItemRevisional,
  mensagemDeErro,
} from "@/src/server/actions/item-revisional-estado";
import type { ItemRevisionalListagem } from "./tipos";

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
// (#edit-itens-N, Mockup.html:851-861) — clone 1:1 do padrão de
// src/components/ativos/linha-edicao.tsx (Story 2.2). O mesmo form comum
// aqui também muda o Status livremente (inclusive para Arquivado) —
// distinto do gate separado de "excluir" (Boundaries/I-O Matrix): um
// usuário com can(editar,'itens') mas sem can(excluir,'itens') (Técnico de
// manutenção) consegue editar nome/descrição/controles/status livremente
// por este form, mas nunca aciona o botão de excluir.
export function LinhaEdicao({
  item,
  onFechar,
  onSucesso,
}: {
  item: ItemRevisionalListagem;
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    editarItemRevisionalAction,
    estadoInicialAcaoItemRevisional,
  );

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id={`edit-itens-${item.id}`}>
      <td colSpan={5}>
        <div className="form-row-label">Editar item · {item.nome}</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <input type="hidden" name="itemRevisionalId" value={item.id} />
          <div className="inline-form">
            <div className="f">
              <label htmlFor={`ei-nome-${item.id}`}>Nome do item</label>
              <input
                id={`ei-nome-${item.id}`}
                name="nome"
                type="text"
                defaultValue={item.nome}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ei-descricao-${item.id}`}>Descrição</label>
              <input
                id={`ei-descricao-${item.id}`}
                name="descricao"
                type="text"
                defaultValue={item.descricao ?? ""}
              />
            </div>
            <div className="f">
              <label htmlFor={`ei-dias-${item.id}`}>A cada (dias)</label>
              <input
                id={`ei-dias-${item.id}`}
                name="diasPadrao"
                type="number"
                min={1}
                defaultValue={item.diasPadrao ?? ""}
                placeholder="Opcional"
              />
            </div>
            <div className="f">
              <label htmlFor={`ei-km-${item.id}`}>A cada (km)</label>
              <input
                id={`ei-km-${item.id}`}
                name="kmPadrao"
                type="number"
                min={1}
                defaultValue={item.kmPadrao ?? ""}
                placeholder="Opcional"
              />
            </div>
            <div className="f">
              <label htmlFor={`ei-horas-${item.id}`}>A cada (horas)</label>
              <input
                id={`ei-horas-${item.id}`}
                name="horasPadrao"
                type="number"
                min={1}
                defaultValue={item.horasPadrao ?? ""}
                placeholder="Opcional"
              />
            </div>
            <div className="f">
              <label htmlFor={`ei-status-${item.id}`}>Status</label>
              <select
                id={`ei-status-${item.id}`}
                name="status"
                required
                defaultValue={item.status}
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
