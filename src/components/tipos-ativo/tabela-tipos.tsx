"use client";

import { Fragment, useState } from "react";

import { StatusBadge, type TomBadge } from "@/src/components/shared/status-badge";
import type { StatusTipoAtivo } from "@prisma/client";
import { LinhaCriacao } from "./linha-criacao";
import { LinhaEdicao } from "./linha-edicao";
import type { TipoAtivoListagem } from "./tipos";

const BADGE_POR_STATUS: Record<StatusTipoAtivo, { tom: TomBadge; label: string }> = {
  Ativo: { tom: "ok", label: "Ativo" },
  Arquivado: { tom: "neutral", label: "Arquivado" },
};

// Tela Tipos de ativo (Story 2.1), portada de Mockup.html:726-811 (UX-DR3:
// linha expansível de criação/edição dentro da própria tabela — mesmo
// padrão de src/components/usuarios/tabela-usuarios.tsx). can() já rodou no
// servidor (app/(dashboard)/tipos/page.tsx) — podeCriar/podeEditar só
// refletem esse resultado aqui, nunca uma checagem paralela (AD-2).
//
// Busca e filtro de status são 100% client-side sobre a lista já carregada
// (Boundaries: nenhuma Server Action é chamada ao alternar filtro/busca). A
// coluna "Ativos vinculados" é fixa em "0" nesta story (Intent/Boundaries) —
// a Story 2.2 troca isso por uma contagem real quando o modelo Ativo
// existir.
export function TabelaTipos({
  tipos,
  podeCriar,
  podeEditar,
}: {
  tipos: TipoAtivoListagem[];
  podeCriar: boolean;
  podeEditar: boolean;
}) {
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<"all" | StatusTipoAtivo>("all");

  const fecharLinha = () => setLinhaAberta(null);

  const buscaNormalizada = busca.trim().toLowerCase();
  const tiposFiltrados = tipos.filter((tipo) => {
    const combinaBusca =
      !buscaNormalizada ||
      tipo.nome.toLowerCase().includes(buscaNormalizada) ||
      (tipo.descricao?.toLowerCase().includes(buscaNormalizada) ?? false);
    const combinaStatus = statusFiltro === "all" || tipo.status === statusFiltro;
    return combinaBusca && combinaStatus;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tipos de ativo</h1>
          <p>Categorias usadas para classificar os ativos cadastrados.</p>
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
          Novo tipo
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar tipo"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
        <select
          className="status-select"
          value={statusFiltro}
          onChange={(evento) =>
            setStatusFiltro(evento.target.value as "all" | StatusTipoAtivo)
          }
        >
          <option value="all">Status: Todos</option>
          <option value="Ativo">Ativo</option>
          <option value="Arquivado">Arquivado</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Descrição</th>
              <th>Ativos vinculados</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhaAberta === "create" && podeCriar ? (
              <LinhaCriacao onFechar={fecharLinha} onSucesso={fecharLinha} />
            ) : null}

            {tiposFiltrados.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhum tipo encontrado.
                </td>
              </tr>
            ) : null}

            {tiposFiltrados.map((tipo) => {
              const badge = BADGE_POR_STATUS[tipo.status];
              return (
                <Fragment key={tipo.id}>
                  <tr data-row>
                    <td>
                      <div className="primary-text">{tipo.nome}</div>
                    </td>
                    <td className="muted">{tipo.descricao ?? "—"}</td>
                    <td>0</td>
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
                            setLinhaAberta((atual) => (atual === tipo.id ? null : tipo.id))
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                  {linhaAberta === tipo.id && podeEditar ? (
                    <LinhaEdicao tipo={tipo} onFechar={fecharLinha} onSucesso={fecharLinha} />
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
