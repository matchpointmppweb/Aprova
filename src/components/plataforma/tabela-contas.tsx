"use client";

import { Fragment, useState } from "react";

import { StatusBadge, type TomBadge } from "@/src/components/shared/status-badge";
import type { StatusConta } from "@prisma/client";
import { LinhaCriacao } from "./linha-criacao";
import { LinhaEdicao } from "./linha-edicao";
import type { ContaListagem } from "./tipos";

const BADGE_POR_STATUS: Record<StatusConta, { tom: TomBadge; label: string }> = {
  Ativa: { tom: "ok", label: "Ativa" },
  PagamentoPendente: { tom: "warn", label: "Pagamento pendente" },
};

// Tela Contas (CAP-8, Story 1.4), portada de Mockup.html:1077-1144 (UX-DR2/
// UX-DR3: linha expansível de criar/editar dentro da própria tabela), mesmo
// padrão de src/components/usuarios/tabela-usuarios.tsx (Story 1.2). Sem
// podeCriar/podeEditar: esta área nunca usa can()/PerfilAcesso (AD-13) — o
// único gate é exigirOperadorDePlataforma(), já aplicado no layout antes de
// esta tabela ser renderizada.
export function TabelaContas({ contas }: { contas: ContaListagem[] }) {
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<"all" | StatusConta>("all");
  // Recado de sucesso ao operador (Story 6.7) — hoje, o administrador informado
  // já tinha acesso à plataforma e por isso não recebeu e-mail de definição de
  // senha. Vive aqui porque a linha de criação se desmonta ao concluir.
  const [aviso, setAviso] = useState<string | null>(null);

  const fecharLinha = () => setLinhaAberta(null);

  const buscaNormalizada = busca.trim().toLowerCase();
  const contasFiltradas = contas.filter((conta) => {
    const combinaBusca =
      !buscaNormalizada ||
      conta.nome.toLowerCase().includes(buscaNormalizada) ||
      conta.cnpj.toLowerCase().includes(buscaNormalizada);
    const combinaStatus = statusFiltro === "all" || conta.status === statusFiltro;
    return combinaBusca && combinaStatus;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Contas</h1>
          <p>Empresas e unidades com contrato ativo na plataforma.</p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            setAviso(null);
            setLinhaAberta((atual) => (atual === "create" ? null : "create"));
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nova conta
        </button>
      </div>

      {aviso ? <div className="form-success">{aviso}</div> : null}

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar por nome ou CNPJ"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
        <select
          className="status-select"
          value={statusFiltro}
          onChange={(evento) => setStatusFiltro(evento.target.value as "all" | StatusConta)}
        >
          <option value="all">Status: Todos</option>
          <option value="Ativa">Ativa</option>
          <option value="PagamentoPendente">Pagamento pendente</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Conta</th>
              <th>CNPJ</th>
              <th>Plano contratado</th>
              <th>Usuários</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhaAberta === "create" ? (
              <LinhaCriacao
                onFechar={fecharLinha}
                onSucesso={(avisoDaCriacao) => {
                  setAviso(avisoDaCriacao ?? null);
                  fecharLinha();
                }}
              />
            ) : null}

            {contasFiltradas.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhuma conta encontrada.
                </td>
              </tr>
            ) : null}

            {contasFiltradas.map((conta) => {
              const badge = BADGE_POR_STATUS[conta.status];
              return (
                <Fragment key={conta.id}>
                  <tr data-row>
                    <td>
                      <div className="primary-text">{conta.nome}</div>
                    </td>
                    <td className="code">{conta.cnpj}</td>
                    <td>{conta.planoContratado}</td>
                    <td>{conta._count.usuarios}</td>
                    <td>
                      <StatusBadge tom={badge.tom} label={badge.label} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-btn"
                          type="button"
                          title="Editar"
                          onClick={() =>
                            setLinhaAberta((atual) => (atual === conta.id ? null : conta.id))
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                  {linhaAberta === conta.id ? (
                    <LinhaEdicao conta={conta} onFechar={fecharLinha} onSucesso={fecharLinha} />
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
