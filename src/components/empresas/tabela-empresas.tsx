"use client";

import { Fragment, useState } from "react";

import { LinhaCriacao } from "./linha-criacao";
import { LinhaEdicao } from "./linha-edicao";
import type { EmpresaListagem } from "./tipos";

// Tela Empresas (Story 5.2), portada de Mockups/Mochup_atual.html:1126-1193
// (UX-DR3: linha expansível de criação/edição dentro da própria tabela, sem
// modal separado). Mesmo padrão de src/components/locais/tabela-locais.tsx,
// mas sem coluna/filtro de Status e sem <MapaEditor> — Empresa não tem
// nenhum dos dois (Boundaries/AD-17: só a ação "Editar" por linha). can() já
// rodou no servidor (app/(dashboard)/empresas/page.tsx) — podeCriar/
// podeEditar só refletem esse resultado aqui, nunca uma checagem paralela
// (AD-2).
//
// Busca é 100% client-side sobre a lista já carregada (Boundaries: nenhuma
// Server Action é chamada ao alternar a busca).
export function TabelaEmpresas({
  empresas,
  podeCriar,
  podeEditar,
}: {
  empresas: EmpresaListagem[];
  podeCriar: boolean;
  podeEditar: boolean;
}) {
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  const fecharLinha = () => setLinhaAberta(null);

  const buscaNormalizada = busca.trim().toLowerCase();
  const empresasFiltradas = empresas.filter((empresa) => {
    return (
      !buscaNormalizada ||
      empresa.razaoSocial.toLowerCase().includes(buscaNormalizada) ||
      empresa.nomeFantasia.toLowerCase().includes(buscaNormalizada) ||
      (empresa.cnpj ?? "").toLowerCase().includes(buscaNormalizada)
    );
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Empresas</h1>
          <p>Empresas e prestadores relacionados à operação.</p>
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
          Nova empresa
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar por razão social, nome fantasia ou CNPJ"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Razão social</th>
              <th>Nome fantasia</th>
              <th>CNPJ</th>
              <th>CPF</th>
              <th>Observação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhaAberta === "create" && podeCriar ? (
              <LinhaCriacao onFechar={fecharLinha} onSucesso={fecharLinha} />
            ) : null}

            {empresasFiltradas.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhuma empresa encontrada.
                </td>
              </tr>
            ) : null}

            {empresasFiltradas.map((empresa) => (
              <Fragment key={empresa.id}>
                <tr data-row>
                  <td>
                    <div className="primary-text">{empresa.razaoSocial}</div>
                  </td>
                  <td className="muted">{empresa.nomeFantasia}</td>
                  <td className="mono muted">{empresa.cnpj ?? "—"}</td>
                  <td className="mono muted">{empresa.cpf ?? "—"}</td>
                  <td className="muted">{empresa.observacao ?? "—"}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-btn"
                        type="button"
                        title="Editar"
                        disabled={!podeEditar}
                        onClick={() =>
                          setLinhaAberta((atual) => (atual === empresa.id ? null : empresa.id))
                        }
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
                {linhaAberta === empresa.id && podeEditar ? (
                  <LinhaEdicao empresa={empresa} onFechar={fecharLinha} onSucesso={fecharLinha} />
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
