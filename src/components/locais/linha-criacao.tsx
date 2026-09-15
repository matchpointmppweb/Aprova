"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { criarLocalAction } from "@/src/server/actions/local";
import {
  estadoInicialAcaoLocal,
  mensagemDeErro,
} from "@/src/server/actions/local-estado";
import { MapaEditor, type PontoMapa } from "./mapa-editor";

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
// (#create-locais, linhas 987-1018). O polígono desenhado no <MapaEditor>
// vira um campo oculto (`areaPoligono`, JSON.stringify(pontos)) submetido
// junto do resto do form — nenhuma chamada de rede separada (Boundaries).
export function LinhaCriacao({
  onFechar,
  onSucesso,
}: {
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    criarLocalAction,
    estadoInicialAcaoLocal,
  );
  const [pontos, setPontos] = useState<PontoMapa[]>([]);

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id="create-locais">
      <td colSpan={5}>
        <div className="form-row-label">Novo local</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <input type="hidden" name="areaPoligono" value={JSON.stringify(pontos)} />
          <div className="inline-form">
            <div className="f">
              <label htmlFor="cl-nome">Nome do local</label>
              <input
                id="cl-nome"
                name="nome"
                type="text"
                placeholder="Ex.: Planta 3 · Depósito"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="cl-endereco">Endereço</label>
              <input
                id="cl-endereco"
                name="endereco"
                type="text"
                placeholder="Rua, número, bairro, cidade"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="cl-status">Status</label>
              <select id="cl-status" name="status" required defaultValue="Ativo">
                <option value="Ativo">Ativo</option>
                <option value="Inativo">Inativo</option>
              </select>
            </div>
            <Acoes onFechar={onFechar} />
          </div>
          <MapaEditor pontos={pontos} onChange={setPontos} />
        </form>
      </td>
    </tr>
  );
}
