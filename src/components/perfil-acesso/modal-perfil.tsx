"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { MODULOS_PERFIL, NOME_ADMINISTRADOR } from "@/src/lib/modulos";
import {
  criarPerfilAcessoAction,
  editarPerfilAcessoAction,
} from "@/src/server/actions/perfil-acesso";
import {
  estadoInicialAcaoPerfil,
  mensagemDeErro,
} from "@/src/server/actions/perfil-acesso-estado";
import type { PerfilAcessoListagem } from "./tipos";

type AbaModal = "geral" | "permissoes";

// useFormStatus só funciona num componente descendente do <form> (não no
// que o renderiza) — mesmo padrão de LinhaConvite/LinhaEdicao (Story 1.2).
function Acoes({ onFechar }: { onFechar: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="modal-footer">
      <button
        className="btn btn-ghost"
        type="button"
        onClick={onFechar}
        disabled={pending}
      >
        Cancelar
      </button>
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar perfil"}
      </button>
    </div>
  );
}

// Modal tabbed Geral/Permissões (UX-DR4), portado de Mockup.html:1334-1361.
// perfil === null -> modo criação; perfil preenchido -> modo edição. Local a
// esta tela (Code Map) — não um primitivo compartilhado ainda, é o único
// modal do app até agora.
export function ModalPerfil({
  perfil,
  onFechar,
  onSucesso,
}: {
  perfil: PerfilAcessoListagem | null;
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const acao = perfil ? editarPerfilAcessoAction : criarPerfilAcessoAction;
  const [estado, formAction] = useActionState(acao, estadoInicialAcaoPerfil);
  const [aba, setAba] = useState<AbaModal>("geral");

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);
  const nomeBloqueado = perfil?.nome === NOME_ADMINISTRADOR;

  const permissaoPorModulo = new Map(
    (perfil?.permissoes ?? []).map((permissao) => [permissao.modulo, permissao]),
  );

  return (
    <div className="modal-overlay" onClick={onFechar}>
      <div className="modal" onClick={(evento) => evento.stopPropagation()}>
        <div className="modal-header">
          <h2>{perfil ? `Editar perfil · ${perfil.nome}` : "Novo perfil de acesso"}</h2>
          <button className="modal-close" type="button" onClick={onFechar}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-tabs">
          <button
            type="button"
            className={`modal-tab-btn${aba === "geral" ? " active" : ""}`}
            onClick={() => setAba("geral")}
          >
            Geral
          </button>
          <button
            type="button"
            className={`modal-tab-btn${aba === "permissoes" ? " active" : ""}`}
            onClick={() => setAba("permissoes")}
          >
            Permissões
          </button>
        </div>

        {erro ? (
          <div className="form-error" style={{ margin: "16px 24px 0" }}>
            {erro}
          </div>
        ) : null}

        <form action={formAction}>
          {perfil ? <input type="hidden" name="perfilAcessoId" value={perfil.id} /> : null}

          <div className="modal-body">
            <div className={`modal-tab-panel${aba === "geral" ? "" : " hidden"}`}>
              <div className="modal-grid">
                <div className="f f-full">
                  <label htmlFor="perfil-nome">Nome do perfil</label>
                  <input
                    id="perfil-nome"
                    name="nome"
                    type="text"
                    placeholder="Ex.: Supervisor de planta"
                    defaultValue={perfil?.nome ?? ""}
                    readOnly={nomeBloqueado}
                    style={
                      nomeBloqueado
                        ? { background: "var(--paper-2)", cursor: "not-allowed" }
                        : undefined
                    }
                    required
                  />
                </div>
                <div className="f f-full">
                  <label htmlFor="perfil-descricao">Descrição</label>
                  <input
                    id="perfil-descricao"
                    name="descricao"
                    type="text"
                    placeholder="O que esse perfil pode fazer"
                    defaultValue={perfil?.descricao ?? ""}
                  />
                </div>
              </div>
            </div>

            <div className={`modal-tab-panel${aba === "permissoes" ? "" : " hidden"}`}>
              <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                Defina, para cada módulo do sistema, se este perfil pode criar, editar ou
                excluir registros.
              </p>
              <table className="perm-table">
                <thead>
                  <tr>
                    <th>Módulo</th>
                    <th className="perm-check-col">Criar</th>
                    <th className="perm-check-col">Editar</th>
                    <th className="perm-check-col">Excluir</th>
                  </tr>
                </thead>
                <tbody>
                  {MODULOS_PERFIL.map((modulo) => {
                    const atual = permissaoPorModulo.get(modulo.key);
                    return (
                      <tr key={modulo.key}>
                        <td>{modulo.label}</td>
                        <td className="perm-check-col">
                          <input
                            type="checkbox"
                            name={`perm-${modulo.key}-criar`}
                            defaultChecked={atual?.criar ?? false}
                          />
                        </td>
                        <td className="perm-check-col">
                          <input
                            type="checkbox"
                            name={`perm-${modulo.key}-editar`}
                            defaultChecked={atual?.editar ?? false}
                          />
                        </td>
                        <td className="perm-check-col">
                          <input
                            type="checkbox"
                            name={`perm-${modulo.key}-excluir`}
                            defaultChecked={atual?.excluir ?? false}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Acoes onFechar={onFechar} />
        </form>
      </div>
    </div>
  );
}
