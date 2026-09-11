"use client";

import { Fragment, useState } from "react";

import { StatusBadge, type TomBadge } from "@/src/components/shared/status-badge";
import type { StatusUsuario } from "@prisma/client";
import { LinhaConvite } from "./linha-convite";
import { LinhaEdicao } from "./linha-edicao";
import type { PerfilAcessoOpcao, UsuarioListagem } from "./tipos";

const BADGE_POR_STATUS: Record<StatusUsuario, { tom: TomBadge; label: string }> = {
  Ativo: { tom: "ok", label: "Ativo" },
  ConvitePendente: { tom: "neutral", label: "Convite pendente" },
  Inativo: { tom: "off", label: "Inativo" },
};

function obterIniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

function formatarUltimoAcesso(data: Date | string | null) {
  if (!data) return "—";
  const dataObj = typeof data === "string" ? new Date(data) : data;
  return dataObj.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Tela Usuários (CAP-7), portada de Mockup.html:982-1075 (UX-DR3: linha
// expansível de convite/edição dentro da própria tabela). can() já rodou no
// servidor (app/(dashboard)/usuarios/page.tsx) — podeCriar/podeEditar só
// refletem esse resultado aqui, nunca uma checagem paralela (AD-2).
export function TabelaUsuarios({
  usuarios,
  perfis,
  podeCriar,
  podeEditar,
}: {
  usuarios: UsuarioListagem[];
  perfis: PerfilAcessoOpcao[];
  podeCriar: boolean;
  podeEditar: boolean;
}) {
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<"all" | StatusUsuario>("all");

  const fecharLinha = () => setLinhaAberta(null);

  const buscaNormalizada = busca.trim().toLowerCase();
  const usuariosFiltrados = usuarios.filter((usuario) => {
    const combinaBusca =
      !buscaNormalizada ||
      usuario.nome.toLowerCase().includes(buscaNormalizada) ||
      usuario.email.toLowerCase().includes(buscaNormalizada);
    const combinaStatus = statusFiltro === "all" || usuario.status === statusFiltro;
    return combinaBusca && combinaStatus;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Usuários</h1>
          <p>Pessoas com acesso ao painel administrativo.</p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!podeCriar}
          onClick={() => setLinhaAberta((atual) => (atual === "create" ? null : "create"))}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Convidar usuário
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar por nome ou e-mail"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
        <select
          className="status-select"
          value={statusFiltro}
          onChange={(evento) => setStatusFiltro(evento.target.value as "all" | StatusUsuario)}
        >
          <option value="all">Status: Todos</option>
          <option value="Ativo">Ativo</option>
          <option value="ConvitePendente">Convite pendente</option>
          <option value="Inativo">Inativo</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Perfil de acesso</th>
              <th>Último acesso</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhaAberta === "create" && podeCriar ? (
              <LinhaConvite perfis={perfis} onFechar={fecharLinha} onSucesso={fecharLinha} />
            ) : null}

            {usuariosFiltrados.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhum usuário encontrado.
                </td>
              </tr>
            ) : null}

            {usuariosFiltrados.map((usuario) => {
              const badge = BADGE_POR_STATUS[usuario.status];
              return (
                <Fragment key={usuario.id}>
                  <tr data-row>
                    <td className="cell-user">
                      <div className="avatar-sm">{obterIniciais(usuario.nome)}</div>
                      <div>
                        <div className="primary-text">{usuario.nome}</div>
                        <div className="sub-text">{usuario.email}</div>
                      </div>
                    </td>
                    <td>{usuario.perfilAcesso.nome}</td>
                    <td>{formatarUltimoAcesso(usuario.ultimoAcesso)}</td>
                    <td>
                      <StatusBadge tom={badge.tom} label={badge.label} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-btn"
                          type="button"
                          title="Editar"
                          disabled={!podeEditar}
                          onClick={() =>
                            setLinhaAberta((atual) => (atual === usuario.id ? null : usuario.id))
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                  {linhaAberta === usuario.id && podeEditar ? (
                    <LinhaEdicao
                      usuario={usuario}
                      perfis={perfis}
                      onFechar={fecharLinha}
                      onSucesso={fecharLinha}
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
