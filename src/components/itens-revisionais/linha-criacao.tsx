"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { criarItemRevisionalAction } from "@/src/server/actions/item-revisional";
import {
  estadoInicialAcaoItemRevisional,
  mensagemDeErro,
} from "@/src/server/actions/item-revisional-estado";

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
// (#create-itens, Mockup.html:832-848) — clone 1:1 do padrão de
// src/components/ativos/linha-criacao.tsx (Story 2.2). Diferente do
// mockup: 3 campos numéricos opcionais lado a lado em vez de checkboxes
// soltos, já que "valor não-nulo = controle selecionado" é o modelo real
// (Design Notes da spec) — a mesma forma é reaproveitada por LinhaEdicao.
export function LinhaCriacao({
  onFechar,
  onSucesso,
}: {
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    criarItemRevisionalAction,
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
    <tr className="form-row" id="create-itens">
      <td colSpan={5}>
        <div className="form-row-label">Novo item revisional</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <div className="inline-form">
            <div className="f">
              <label htmlFor="ci-nome">Nome do item</label>
              <input
                id="ci-nome"
                name="nome"
                type="text"
                placeholder="Ex.: Troca de filtro de ar"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="ci-descricao">Descrição</label>
              <input
                id="ci-descricao"
                name="descricao"
                type="text"
                placeholder="Descreva a verificação"
              />
            </div>
            <div className="f">
              <label htmlFor="ci-dias">A cada (dias)</label>
              <input id="ci-dias" name="diasPadrao" type="number" min={1} placeholder="Opcional" />
            </div>
            <div className="f">
              <label htmlFor="ci-km">A cada (km)</label>
              <input id="ci-km" name="kmPadrao" type="number" min={1} placeholder="Opcional" />
            </div>
            <div className="f">
              <label htmlFor="ci-horas">A cada (horas)</label>
              <input
                id="ci-horas"
                name="horasPadrao"
                type="number"
                min={1}
                placeholder="Opcional"
              />
            </div>
            <div className="f">
              <label htmlFor="ci-status">Status</label>
              <select id="ci-status" name="status" required defaultValue="Ativo">
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
