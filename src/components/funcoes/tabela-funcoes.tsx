"use client";

import { Fragment, useState } from "react";

import { StatusBadge, type TomBadge } from "@/src/components/shared/status-badge";
import type { StatusFuncao } from "@prisma/client";
import { LinhaCriacao } from "./linha-criacao";
import { LinhaEdicao } from "./linha-edicao";
import type { FuncaoListagem } from "./tipos";

const BADGE_POR_STATUS: Record<StatusFuncao, { tom: TomBadge; label: string }> = {
  Ativo: { tom: "ok", label: "Ativo" },
  Inativo: { tom: "neutral", label: "Inativo" },
};

// Tela Funções (Story 5.3), portada de Mockups/Mochup_atual.html:1267-1337
// (UX-DR3: linha expansível de criação/edição dentro da própria tabela, sem
// modal separado). Mesmo padrão de src/components/locais/tabela-locais.tsx.
// can() já rodou no servidor (app/(dashboard)/funcoes/page.tsx) —
// podeCriar/podeEditar só refletem esse resultado aqui, nunca uma checagem
// paralela (AD-2).
//
// Busca e filtro de status são 100% client-side sobre a lista já carregada
// (Boundaries: nenhuma Server Action é chamada ao alternar filtro/busca).
export function TabelaFuncoes({
  funcoes,
  podeCriar,
  podeEditar,
}: {
  funcoes: FuncaoListagem[];
  podeCriar: boolean;
  podeEditar: boolean;
}) {
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<"all" | StatusFuncao>("all");

  const fecharLinha = () => setLinhaAberta(null);

  const buscaNormalizada = busca.trim().toLowerCase();
  const funcoesFiltradas = funcoes.filter((funcao) => {
    const combinaBusca =
      !buscaNormalizada || funcao.descricao.toLowerCase().includes(buscaNormalizada);
    const combinaStatus = statusFiltro === "all" || funcao.status === statusFiltro;
    return combinaBusca && combinaStatus;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Funções</h1>
          <p>Funções usadas no cadastro de pessoas.</p>
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
          Nova função
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar função"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
        <select
          className="status-select"
          value={statusFiltro}
          onChange={(evento) =>
            setStatusFiltro(evento.target.value as "all" | StatusFuncao)
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

            {funcoesFiltradas.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhuma função encontrada.
                </td>
              </tr>
            ) : null}

            {funcoesFiltradas.map((funcao) => {
              const badgeStatus = BADGE_POR_STATUS[funcao.status];
              return (
                <Fragment key={funcao.id}>
                  <tr data-row>
                    <td>
                      <div className="primary-text">{funcao.descricao}</div>
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
                            setLinhaAberta((atual) => (atual === funcao.id ? null : funcao.id))
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                  {linhaAberta === funcao.id && podeEditar ? (
                    <LinhaEdicao funcao={funcao} onFechar={fecharLinha} onSucesso={fecharLinha} />
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
