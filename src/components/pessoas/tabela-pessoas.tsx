"use client";

import { Fragment, useState } from "react";

import { LinhaCriacao } from "./linha-criacao";
import { LinhaEdicao } from "./linha-edicao";
import type { OpcaoReferencia, PessoaListagem } from "./tipos";

// Tela Pessoas (Story 5.4), portada de Mockups/Mochup_atual.html:1339-1408
// (UX-DR3: linha expansível de criação/edição dentro da própria tabela, sem
// modal separado). Mesmo padrão de src/components/empresas/tabela-empresas.tsx
// — sem coluna/filtro de Status e sem <MapaEditor> (Boundaries/AD-17/AD-18:
// só a ação "Editar" por linha). can() já rodou no servidor
// (app/(dashboard)/pessoas/page.tsx) — podeCriar/podeEditar só refletem esse
// resultado aqui, nunca uma checagem paralela (AD-2).
//
// Busca é 100% client-side sobre a lista já carregada, por nome ou CPF
// (Boundaries: nenhuma Server Action é chamada ao alternar a busca). Os
// filter-chips "Cargo"/"Função" do mockup são decorativos, sem `onchange`
// (mesma convenção já usada em Ativos — Boundaries: fora de escopo desta
// story implementá-los como filtro real).
// Mesmas iniciais de tabela-usuarios.tsx/tabela-planos.tsx/tabela-emissao.tsx
// — o mockup usa `cell-user` + `avatar-sm` na coluna Nome desta tela também
// (Mockups/Mochup_atual.html:1367, AD-4).
function obterIniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

export function TabelaPessoas({
  pessoas,
  cargos,
  funcoes,
  podeCriar,
  podeEditar,
}: {
  pessoas: PessoaListagem[];
  cargos: OpcaoReferencia[];
  funcoes: OpcaoReferencia[];
  podeCriar: boolean;
  podeEditar: boolean;
}) {
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  const fecharLinha = () => setLinhaAberta(null);

  const buscaNormalizada = busca.trim().toLowerCase();
  const pessoasFiltradas = pessoas.filter((pessoa) => {
    return (
      !buscaNormalizada ||
      pessoa.nome.toLowerCase().includes(buscaNormalizada) ||
      pessoa.cpf.toLowerCase().includes(buscaNormalizada)
    );
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Pessoas</h1>
          <p>Pessoas que executam serviços e checklists, com cargo e função vinculados.</p>
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
          Nova pessoa
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar por nome ou CPF"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
        <div className="filter-chip">
          Cargo
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
        <div className="filter-chip">
          Função
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>CPF</th>
              <th>Cargo</th>
              <th>Função</th>
              <th>Observação</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhaAberta === "create" && podeCriar ? (
              <LinhaCriacao
                cargos={cargos}
                funcoes={funcoes}
                onFechar={fecharLinha}
                onSucesso={fecharLinha}
              />
            ) : null}

            {pessoasFiltradas.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhuma pessoa encontrada.
                </td>
              </tr>
            ) : null}

            {pessoasFiltradas.map((pessoa) => (
              <Fragment key={pessoa.id}>
                <tr data-row>
                  <td className="cell-user">
                    <div className="avatar-sm">{obterIniciais(pessoa.nome)}</div>
                    <div className="primary-text">{pessoa.nome}</div>
                  </td>
                  <td className="mono muted">{pessoa.cpf}</td>
                  <td className="muted">{pessoa.cargoNome}</td>
                  <td className="muted">{pessoa.funcaoNome}</td>
                  <td className="muted">{pessoa.observacao ?? "—"}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-btn"
                        type="button"
                        title="Editar"
                        disabled={!podeEditar}
                        onClick={() =>
                          setLinhaAberta((atual) => (atual === pessoa.id ? null : pessoa.id))
                        }
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
                {linhaAberta === pessoa.id && podeEditar ? (
                  <LinhaEdicao
                    pessoa={pessoa}
                    cargos={cargos}
                    funcoes={funcoes}
                    onFechar={fecharLinha}
                    onSucesso={fecharLinha}
                  />
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
