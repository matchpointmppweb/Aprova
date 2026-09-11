"use client";

import { useState } from "react";

import { ModalPerfil } from "./modal-perfil";
import type { PerfilAcessoListagem, PermissaoListagem } from "./tipos";

type BadgePermissao = { label: string; tom: "ok" | "neutral" };

// Resumo de permissões da linha (`.perm-badges`, Mockup.html:1148-1189): uma
// tag "ok" por ação (Criar/Editar/Excluir) que o perfil tem em pelo menos um
// módulo, ou "Sem permissões de escrita" quando nenhuma das 3 ações está
// marcada em nenhum módulo (ex. perfil "Somente leitura" do seed).
function resumoPermissoes(permissoes: PermissaoListagem[]): BadgePermissao[] {
  const temCriar = permissoes.some((permissao) => permissao.criar);
  const temEditar = permissoes.some((permissao) => permissao.editar);
  const temExcluir = permissoes.some((permissao) => permissao.excluir);

  if (!temCriar && !temEditar && !temExcluir) {
    return [{ label: "Sem permissões de escrita", tom: "neutral" }];
  }

  const badges: BadgePermissao[] = [];
  if (temCriar) badges.push({ label: "Criar", tom: "ok" });
  if (temEditar) badges.push({ label: "Editar", tom: "ok" });
  if (temExcluir) badges.push({ label: "Excluir", tom: "ok" });
  return badges;
}

// Tela Perfil de acesso (CAP-9), portada de Mockup.html:1148-1189 (listagem)
// + :1334-1361 (modal). can() já rodou no servidor
// (app/(dashboard)/perfil-acesso/page.tsx) — podeCriar/podeEditar só
// refletem esse resultado aqui, nunca uma checagem paralela (AD-2).
export function TabelaPerfis({
  perfis,
  podeCriar,
  podeEditar,
}: {
  perfis: PerfilAcessoListagem[];
  podeCriar: boolean;
  podeEditar: boolean;
}) {
  const [modalAberto, setModalAberto] = useState<"create" | string | null>(null);

  const fecharModal = () => setModalAberto(null);
  const perfilEmEdicao =
    modalAberto && modalAberto !== "create"
      ? perfis.find((perfil) => perfil.id === modalAberto) ?? null
      : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Perfis de acesso</h1>
          <p>Grupos de permissões atribuídos aos usuários.</p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!podeCriar}
          onClick={() => setModalAberto("create")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Novo perfil
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Perfil</th>
              <th>Descrição</th>
              <th>Usuários</th>
              <th>Permissões</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {perfis.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhum perfil encontrado.
                </td>
              </tr>
            ) : null}

            {perfis.map((perfil) => (
              <tr data-row key={perfil.id}>
                <td>
                  <div className="primary-text">{perfil.nome}</div>
                </td>
                <td className="muted">{perfil.descricao ?? "—"}</td>
                <td>{perfil._count.usuarios}</td>
                <td>
                  <div className="perm-badges">
                    {resumoPermissoes(perfil.permissoes).map((badge) => (
                      <span key={badge.label} className={`tag tag-${badge.tom}`}>
                        {badge.label}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      className="icon-btn"
                      type="button"
                      title="Editar"
                      disabled={!podeEditar}
                      onClick={() => setModalAberto(perfil.id)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalAberto === "create" && podeCriar ? (
        <ModalPerfil perfil={null} onFechar={fecharModal} onSucesso={fecharModal} />
      ) : null}
      {perfilEmEdicao && podeEditar ? (
        <ModalPerfil perfil={perfilEmEdicao} onFechar={fecharModal} onSucesso={fecharModal} />
      ) : null}
    </>
  );
}
