"use client";

import { Fragment, useState } from "react";

import { StatusBadge, type TomBadge } from "@/src/components/shared/status-badge";
import type { StatusLocal } from "@prisma/client";
import { LinhaCriacao } from "./linha-criacao";
import { LinhaEdicao } from "./linha-edicao";
import type { LocalListagem } from "./tipos";

const BADGE_POR_STATUS: Record<StatusLocal, { tom: TomBadge; label: string }> = {
  Ativo: { tom: "ok", label: "Ativo" },
  Inativo: { tom: "neutral", label: "Inativo" },
};

// Badge "Definida"/"Não definida" a partir de areaPoligono não-nulo/vazio
// (Code Map) — nunca uma coluna persistida separada, sempre derivada do
// próprio campo.
function badgeArea(areaPoligono: LocalListagem["areaPoligono"]) {
  return areaPoligono && areaPoligono.length >= 3
    ? { tom: "ok" as TomBadge, label: "Definida" }
    : { tom: "neutral" as TomBadge, label: "Não definida" };
}

// Tela Locais (Story 5.1), portada de Mockups/Mochup_atual.html:968-1124
// (UX-DR3: linha expansível de criação/edição dentro da própria tabela,
// embutindo o <MapaEditor> — sem modal separado). Mesmo padrão de
// src/components/tipos-ativo/tabela-tipos.tsx. can() já rodou no servidor
// (app/(dashboard)/locais/page.tsx) — podeCriar/podeEditar só refletem esse
// resultado aqui, nunca uma checagem paralela (AD-2).
//
// Busca e filtro de status são 100% client-side sobre a lista já carregada
// (Boundaries: nenhuma Server Action é chamada ao alternar filtro/busca).
export function TabelaLocais({
  locais,
  podeCriar,
  podeEditar,
}: {
  locais: LocalListagem[];
  podeCriar: boolean;
  podeEditar: boolean;
}) {
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<"all" | StatusLocal>("all");

  const fecharLinha = () => setLinhaAberta(null);

  const buscaNormalizada = busca.trim().toLowerCase();
  const locaisFiltrados = locais.filter((local) => {
    const combinaBusca =
      !buscaNormalizada ||
      local.nome.toLowerCase().includes(buscaNormalizada) ||
      local.endereco.toLowerCase().includes(buscaNormalizada);
    const combinaStatus = statusFiltro === "all" || local.status === statusFiltro;
    return combinaBusca && combinaStatus;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Locais</h1>
          <p>Plantas, pátios e áreas onde os ativos estão instalados, com a delimitação da área no mapa.</p>
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
          Novo local
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar por nome ou endereço"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
        <select
          className="status-select"
          value={statusFiltro}
          onChange={(evento) =>
            setStatusFiltro(evento.target.value as "all" | StatusLocal)
          }
        >
          <option value="all">Status: Todos</option>
          <option value="Ativo">Ativo</option>
          <option value="Inativo">Inativo</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Local</th>
              <th>Endereço</th>
              <th>Área no mapa</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhaAberta === "create" && podeCriar ? (
              <LinhaCriacao onFechar={fecharLinha} onSucesso={fecharLinha} />
            ) : null}

            {locaisFiltrados.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhum local encontrado.
                </td>
              </tr>
            ) : null}

            {locaisFiltrados.map((local) => {
              const badgeStatus = BADGE_POR_STATUS[local.status];
              const badgeAreaLocal = badgeArea(local.areaPoligono);
              return (
                <Fragment key={local.id}>
                  <tr data-row>
                    <td>
                      <div className="primary-text">{local.nome}</div>
                    </td>
                    <td className="muted">{local.endereco}</td>
                    <td>
                      <StatusBadge tom={badgeAreaLocal.tom} label={badgeAreaLocal.label} />
                    </td>
                    <td>
                      <StatusBadge tom={badgeStatus.tom} label={badgeStatus.label} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-btn"
                          type="button"
                          title="Editar"
                          disabled={!podeEditar}
                          onClick={() =>
                            setLinhaAberta((atual) => (atual === local.id ? null : local.id))
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                  {linhaAberta === local.id && podeEditar ? (
                    <LinhaEdicao local={local} onFechar={fecharLinha} onSucesso={fecharLinha} />
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
