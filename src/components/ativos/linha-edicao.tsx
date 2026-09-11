"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { editarAtivoAction } from "@/src/server/actions/ativo";
import { estadoInicialAcaoAtivo, mensagemDeErro } from "@/src/server/actions/ativo-estado";
import type { AtivoListagem, TipoAtivoOpcao } from "./tipos";

const OPCOES_STATUS: { value: string; label: string }[] = [
  { value: "Ativo", label: "Ativo" },
  { value: "Inativo", label: "Inativo" },
  { value: "Bloqueado", label: "Bloqueado" },
  { value: "Vendido", label: "Vendido" },
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
// (#edit-ativos-N, Mockup.html:646-655) — clone 1:1 do padrão de
// src/components/tipos-ativo/linha-edicao.tsx (Story 2.1). O mesmo form
// comum aqui também muda o Status livremente (inclusive para Inativo) —
// distinto do gate separado de "excluir" (Boundaries/I-O Matrix).
export function LinhaEdicao({
  ativo,
  tiposAtivo,
  onFechar,
  onSucesso,
}: {
  ativo: AtivoListagem;
  tiposAtivo: TipoAtivoOpcao[];
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(editarAtivoAction, estadoInicialAcaoAtivo);

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id={`edit-ativos-${ativo.id}`}>
      <td colSpan={7}>
        <div className="form-row-label">Editar ativo · {ativo.codigo}</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <input type="hidden" name="ativoId" value={ativo.id} />
          <div className="inline-form">
            <div className="f">
              <label htmlFor={`ea-nome-${ativo.id}`}>Nome do ativo</label>
              <input
                id={`ea-nome-${ativo.id}`}
                name="nome"
                type="text"
                defaultValue={ativo.nome}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ea-tipo-${ativo.id}`}>Tipo</label>
              <select
                id={`ea-tipo-${ativo.id}`}
                name="tipoAtivoId"
                required
                defaultValue={ativo.tipoAtivoId}
              >
                {tiposAtivo.map((tipo) => (
                  <option key={tipo.id} value={tipo.id}>
                    {tipo.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="f">
              <label htmlFor={`ea-localizacao-${ativo.id}`}>Localização</label>
              <input
                id={`ea-localizacao-${ativo.id}`}
                name="localizacao"
                type="text"
                defaultValue={ativo.localizacao}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ea-numeroSerie-${ativo.id}`}>Nº de série</label>
              <input
                id={`ea-numeroSerie-${ativo.id}`}
                name="numeroSerie"
                type="text"
                defaultValue={ativo.numeroSerie ?? ""}
                placeholder="Opcional"
              />
            </div>
            <div className="f">
              <label htmlFor={`ea-status-${ativo.id}`}>Status</label>
              <select
                id={`ea-status-${ativo.id}`}
                name="status"
                required
                defaultValue={ativo.status}
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
