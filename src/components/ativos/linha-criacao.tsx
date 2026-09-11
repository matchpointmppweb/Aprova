"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { criarAtivoAction } from "@/src/server/actions/ativo";
import { estadoInicialAcaoAtivo, mensagemDeErro } from "@/src/server/actions/ativo-estado";
import type { TipoAtivoOpcao } from "./tipos";

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
// (#create-ativos, Mockup.html:634-643) — clone 1:1 do padrão de
// src/components/tipos-ativo/linha-criacao.tsx (Story 2.1). O select de
// Tipo é populado com tiposAtivo (listarTiposAtivo(contaId) real) em vez do
// hardcoded do mockup (Boundaries).
export function LinhaCriacao({
  tiposAtivo,
  onFechar,
  onSucesso,
}: {
  tiposAtivo: TipoAtivoOpcao[];
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(criarAtivoAction, estadoInicialAcaoAtivo);

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id="create-ativos">
      <td colSpan={7}>
        <div className="form-row-label">Novo ativo</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <div className="inline-form">
            <div className="f">
              <label htmlFor="ca-nome">Nome do ativo</label>
              <input
                id="ca-nome"
                name="nome"
                type="text"
                placeholder="Ex.: Compressor de ar CP-015"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="ca-tipo">Tipo</label>
              <select id="ca-tipo" name="tipoAtivoId" required defaultValue="">
                <option value="" disabled>
                  Selecione um tipo
                </option>
                {tiposAtivo.map((tipo) => (
                  <option key={tipo.id} value={tipo.id}>
                    {tipo.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="f">
              <label htmlFor="ca-localizacao">Localização</label>
              <input
                id="ca-localizacao"
                name="localizacao"
                type="text"
                placeholder="Ex.: Planta 1 · Setor B"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="ca-numeroSerie">Nº de série</label>
              <input
                id="ca-numeroSerie"
                name="numeroSerie"
                type="text"
                placeholder="Opcional"
              />
            </div>
            <div className="f">
              <label htmlFor="ca-status">Status</label>
              <select id="ca-status" name="status" required defaultValue="Ativo">
                <option value="Ativo">Ativo</option>
                <option value="Inativo">Inativo</option>
                <option value="Bloqueado">Bloqueado</option>
                <option value="Vendido">Vendido</option>
              </select>
            </div>
            <Acoes onFechar={onFechar} />
          </div>
        </form>
      </td>
    </tr>
  );
}
