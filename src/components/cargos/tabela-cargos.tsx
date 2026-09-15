"use client";

import { Fragment, useState } from "react";

import { StatusBadge, type TomBadge } from "@/src/components/shared/status-badge";
import type { StatusCargo } from "@prisma/client";
import { LinhaCriacao } from "./linha-criacao";
import { LinhaEdicao } from "./linha-edicao";
import type { CargoListagem } from "./tipos";

const BADGE_POR_STATUS: Record<StatusCargo, { tom: TomBadge; label: string }> = {
  Ativo: { tom: "ok", label: "Ativo" },
  Inativo: { tom: "neutral", label: "Inativo" },
};

// Tela Cargos (Story 5.3), portada de Mockups/Mochup_atual.html:1195-1265
// (UX-DR3: linha expansível de criação/edição dentro da própria tabela, sem
// modal separado). Mesmo padrão de src/components/locais/tabela-locais.tsx.
// can() já rodou no servidor (app/(dashboard)/cargos/page.tsx) —
// podeCriar/podeEditar só refletem esse resultado aqui, nunca uma checagem
// paralela (AD-2).
//
// Busca e filtro de status são 100% client-side sobre a lista já carregada
// (Boundaries: nenhuma Server Action é chamada ao alternar filtro/busca).
export function TabelaCargos({
  cargos,
  podeCriar,
  podeEditar,
}: {
  cargos: CargoListagem[];
  podeCriar: boolean;
  podeEditar: boolean;
}) {
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<"all" | StatusCargo>("all");

  const fecharLinha = () => setLinhaAberta(null);

  const buscaNormalizada = busca.trim().toLowerCase();
  const cargosFiltrados = cargos.filter((cargo) => {
    const combinaBusca =
      !buscaNormalizada || cargo.descricao.toLowerCase().includes(buscaNormalizada);
    const combinaStatus = statusFiltro === "all" || cargo.status === statusFiltro;
    return combinaBusca && combinaStatus;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cargos</h1>
          <p>Cargos usados no cadastro de pessoas.</p>
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
          Novo cargo
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar cargo"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
        <select
          className="status-select"
          value={statusFiltro}
          onChange={(evento) =>
            setStatusFiltro(evento.target.value as "all" | StatusCargo)
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
              <th>Descrição</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhaAberta === "create" && podeCriar ? (
              <LinhaCriacao onFechar={fecharLinha} onSucesso={fecharLinha} />
            ) : null}

            {cargosFiltrados.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhum cargo encontrado.
                </td>
              </tr>
            ) : null}

            {cargosFiltrados.map((cargo) => {
              const badgeStatus = BADGE_POR_STATUS[cargo.status];
              return (
                <Fragment key={cargo.id}>
                  <tr data-row>
                    <td>
                      <div className="primary-text">{cargo.descricao}</div>
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
                            setLinhaAberta((atual) => (atual === cargo.id ? null : cargo.id))
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                  {linhaAberta === cargo.id && podeEditar ? (
                    <LinhaEdicao cargo={cargo} onFechar={fecharLinha} onSucesso={fecharLinha} />
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
