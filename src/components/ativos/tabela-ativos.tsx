"use client";

import { Fragment, useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { StatusBadge, type TomBadge } from "@/src/components/shared/status-badge";
import type { StatusAtivo } from "@prisma/client";
import { excluirAtivoAction } from "@/src/server/actions/ativo";
import { estadoInicialAcaoAtivo } from "@/src/server/actions/ativo-estado";
import { LinhaCriacao } from "./linha-criacao";
import { LinhaEdicao } from "./linha-edicao";
import type { AtivoListagem, TipoAtivoOpcao } from "./tipos";

const BADGE_POR_STATUS: Record<StatusAtivo, { tom: TomBadge; label: string }> = {
  Ativo: { tom: "ok", label: "Ativo" },
  Inativo: { tom: "neutral", label: "Inativo" },
  Bloqueado: { tom: "off", label: "Bloqueado" },
  Vendido: { tom: "neutral", label: "Vendido" },
};

// Ação de excluir isolada num form próprio (mesmo espírito do botão kebab
// não-funcional do mockup, Mockup.html:645, mas implementado como ação
// direta em vez de menu suspenso): confirm() nativo antes de submeter um
// form oculto que chama excluirAtivoAction, cujo gate can(...,'excluir',...)
// nunca reaproveita o de can(...,'editar',...) (Boundaries/AD-2). Só é
// renderizado quando podeExcluir (checado no servidor, app/(dashboard)/
// ativos/page.tsx) — a UI nunca decide isso sozinha.
function BotaoExcluir({ ativo, onSucesso }: { ativo: AtivoListagem; onSucesso: () => void }) {
  const [estado, formAction] = useActionState(excluirAtivoAction, estadoInicialAcaoAtivo);

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  return (
    <form
      action={formAction}
      onSubmit={(evento) => {
        if (!window.confirm(`Excluir o ativo ${ativo.codigo} · ${ativo.nome}?`)) {
          evento.preventDefault();
        }
      }}
    >
      <input type="hidden" name="ativoId" value={ativo.id} />
      <BotaoExcluirSubmit />
    </form>
  );
}

// useFormStatus só funciona num componente descendente do <form> (mesmo
// padrão de Acoes em linha-criacao.tsx/linha-edicao.tsx) — por isso o botão
// de submit fica isolado aqui em vez de ler `pending` direto em BotaoExcluir.
function BotaoExcluirSubmit() {
  const { pending } = useFormStatus();
  return (
    <button className="icon-btn" type="submit" title="Excluir" disabled={pending}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z" />
      </svg>
    </button>
  );
}

// Tela Ativos (Story 2.2), portada de Mockup.html:613-723 (UX-DR3: linha
// expansível de criação/edição dentro da própria tabela — mesmo padrão de
// src/components/tipos-ativo/tabela-tipos.tsx). can() já rodou no servidor
// (app/(dashboard)/ativos/page.tsx) — podeCriar/podeEditar/podeExcluir só
// refletem esse resultado aqui, nunca uma checagem paralela (AD-2).
//
// Busca e filtros (status e tipo) são 100% client-side sobre a lista já
// carregada (Boundaries: nenhuma Server Action é chamada ao alternar
// filtro/busca). "Última revisão" é sempre "—" nesta story — derivada da
// emissão mais recente, ainda não existente (Epic 3/4).
export function TabelaAtivos({
  ativos,
  tiposAtivo,
  podeCriar,
  podeEditar,
  podeExcluir,
}: {
  ativos: AtivoListagem[];
  tiposAtivo: TipoAtivoOpcao[];
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<"all" | StatusAtivo>("all");
  const [tipoFiltro, setTipoFiltro] = useState<"all" | string>("all");

  const fecharLinha = () => setLinhaAberta(null);

  const semTipoCadastrado = tiposAtivo.length === 0;
  const criarDesabilitado = !podeCriar || semTipoCadastrado;

  const buscaNormalizada = busca.trim().toLowerCase();
  const ativosFiltrados = ativos.filter((ativo) => {
    const combinaBusca =
      !buscaNormalizada ||
      ativo.codigo.toLowerCase().includes(buscaNormalizada) ||
      ativo.nome.toLowerCase().includes(buscaNormalizada);
    const combinaStatus = statusFiltro === "all" || ativo.status === statusFiltro;
    const combinaTipo = tipoFiltro === "all" || ativo.tipoAtivoId === tipoFiltro;
    return combinaBusca && combinaStatus && combinaTipo;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ativos</h1>
          <p>Todos os ativos cadastrados na sua operação.</p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={criarDesabilitado}
          title={
            semTipoCadastrado
              ? "Cadastre ao menos um Tipo de ativo antes de criar um ativo."
              : undefined
          }
          onClick={() => setLinhaAberta((atual) => (atual === "create" ? null : "create"))}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Novo ativo
        </button>
      </div>

      {semTipoCadastrado ? (
        <p style={{ color: "var(--ink-soft)" }}>
          Cadastre ao menos um Tipo de ativo antes de criar um ativo.
        </p>
      ) : null}

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar por código ou nome"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
        <select
          className="status-select"
          value={tipoFiltro}
          onChange={(evento) => setTipoFiltro(evento.target.value)}
        >
          <option value="all">Tipo: Todos</option>
          {tiposAtivo.map((tipo) => (
            <option key={tipo.id} value={tipo.id}>
              {tipo.nome}
            </option>
          ))}
        </select>
        <select
          className="status-select"
          value={statusFiltro}
          onChange={(evento) => setStatusFiltro(evento.target.value as "all" | StatusAtivo)}
        >
          <option value="all">Status: Todos</option>
          <option value="Ativo">Ativo</option>
          <option value="Inativo">Inativo</option>
          <option value="Bloqueado">Bloqueado</option>
          <option value="Vendido">Vendido</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Ativo</th>
              <th>Tipo</th>
              <th>Localização</th>
              <th>Última revisão</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhaAberta === "create" && podeCriar && !semTipoCadastrado ? (
              <LinhaCriacao
                tiposAtivo={tiposAtivo}
                onFechar={fecharLinha}
                onSucesso={fecharLinha}
              />
            ) : null}

            {ativosFiltrados.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhum ativo encontrado.
                </td>
              </tr>
            ) : null}

            {ativosFiltrados.map((ativo) => {
              const badge = BADGE_POR_STATUS[ativo.status];
              return (
                <Fragment key={ativo.id}>
                  <tr data-row>
                    <td className="code">{ativo.codigo}</td>
                    <td>
                      <div className="primary-text">{ativo.nome}</div>
                      {ativo.numeroSerie ? (
                        <div className="sub-text">Nº série {ativo.numeroSerie}</div>
                      ) : null}
                    </td>
                    <td>{ativo.tipoAtivo.nome}</td>
                    <td>{ativo.localizacao}</td>
                    <td>—</td>
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
                            setLinhaAberta((atual) => (atual === ativo.id ? null : ativo.id))
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                        {podeExcluir ? (
                          <BotaoExcluir ativo={ativo} onSucesso={fecharLinha} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {linhaAberta === ativo.id && podeEditar ? (
                    <LinhaEdicao
                      ativo={ativo}
                      tiposAtivo={tiposAtivo}
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
