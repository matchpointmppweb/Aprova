"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { editarLocalAction } from "@/src/server/actions/local";
import {
  estadoInicialAcaoLocal,
  mensagemDeErro,
} from "@/src/server/actions/local-estado";
import { MapaEditor, type PontoMapa } from "./mapa-editor";
import type { LocalListagem } from "./tipos";

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

// Linha expansível de edição (UX-DR3), portada de Mockup.html
// (#edit-locais-N, Mockups/Mochup_atual.html:1021-1052). "Inativar" é só
// selecionar Status = Inativo neste mesmo formulário e salvar — não há
// botão de exclusão separado (Boundaries da story). O editor de mapa
// pré-carrega os vértices salvos (local.areaPoligono ?? []), prontos para
// ajuste (I/O Matrix: "Edição pré-carrega polígono").
export function LinhaEdicao({
  local,
  onFechar,
  onSucesso,
}: {
  local: LocalListagem;
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    editarLocalAction,
    estadoInicialAcaoLocal,
  );
  const [pontos, setPontos] = useState<PontoMapa[]>(local.areaPoligono ?? []);

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id={`edit-locais-${local.id}`}>
      <td colSpan={5}>
        <div className="form-row-label">Editar local · {local.nome}</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <input type="hidden" name="localId" value={local.id} />
          <div className="inline-form">
            <div className="f">
              <label htmlFor={`el-nome-${local.id}`}>Nome do local</label>
              <input
                id={`el-nome-${local.id}`}
                name="nome"
                type="text"
                defaultValue={local.nome}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`el-endereco-${local.id}`}>Endereço</label>
              <input
                id={`el-endereco-${local.id}`}
                name="endereco"
                type="text"
                defaultValue={local.endereco}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`el-status-${local.id}`}>Status</label>
              <select
                id={`el-status-${local.id}`}
                name="status"
                required
                defaultValue={local.status}
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
          <input type="hidden" name="areaPoligono" value={JSON.stringify(pontos)} />
          <MapaEditor pontos={pontos} onChange={setPontos} />
        </form>
      </td>
    </tr>
  );
}
