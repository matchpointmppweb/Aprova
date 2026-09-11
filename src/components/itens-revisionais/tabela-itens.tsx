"use client";

import { Fragment, useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { StatusBadge, type TomBadge } from "@/src/components/shared/status-badge";
import type { StatusItemRevisional } from "@prisma/client";
import { excluirItemRevisionalAction } from "@/src/server/actions/item-revisional";
import { estadoInicialAcaoItemRevisional } from "@/src/server/actions/item-revisional-estado";
import { LinhaCriacao } from "./linha-criacao";
import { LinhaEdicao } from "./linha-edicao";
import type { ItemRevisionalListagem } from "./tipos";

const BADGE_POR_STATUS: Record<StatusItemRevisional, { tom: TomBadge; label: string }> = {
  Ativo: { tom: "ok", label: "Ativo" },
  Arquivado: { tom: "neutral", label: "Arquivado" },
};

// Badges do controle de medição mostram só o nome do controle selecionado
// ("Dias"/"Km"/"Horas", tag-neutral), sem o valor (Boundaries, confirmado
// pelo mockup Mockup.html:850,863,875).
function badgesDeControle(item: ItemRevisionalListagem) {
  const badges: string[] = [];
  if (item.diasPadrao !== null) badges.push("Dias");
  if (item.kmPadrao !== null) badges.push("Km");
  if (item.horasPadrao !== null) badges.push("Horas");
  return badges;
}

// Ação de excluir isolada num form próprio — mesmo padrão de
// src/components/ativos/tabela-ativos.tsx (BotaoExcluir/BotaoExcluirSubmit,
// Story 2.2): confirm() nativo antes de submeter um form oculto que chama
// excluirItemRevisionalAction, cujo gate can(...,'excluir',...) nunca
// reaproveita o de can(...,'editar',...) (Boundaries/AD-2). Só é
// renderizado quando podeExcluir (checado no servidor, app/(dashboard)/
// itens-revisionais/page.tsx) — a UI nunca decide isso sozinha.
function BotaoExcluir({
  item,
  onSucesso,
}: {
  item: ItemRevisionalListagem;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    excluirItemRevisionalAction,
    estadoInicialAcaoItemRevisional,
  );

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
        if (!window.confirm(`Excluir o item revisional ${item.nome}?`)) {
          evento.preventDefault();
        }
      }}
    >
      <input type="hidden" name="itemRevisionalId" value={item.id} />
      <BotaoExcluirSubmit />
    </form>
  );
}

// useFormStatus só funciona num componente descendente do <form> (mesmo
// padrão de Acoes em linha-criacao.tsx/linha-edicao.tsx) — por isso o botão
// de submit fica isolado aqui em vez de ler `pending` direto em
// BotaoExcluir.
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

// Tela Itens revisionais (Story 3.1), portada de Mockup.html:814-914
// (UX-DR3: linha expansível de criação/edição dentro da própria tabela —
// mesmo padrão de src/components/ativos/tabela-ativos.tsx, que é a que já
// tem um botão de excluir independente para reaproveitar 1:1). can() já
// rodou no servidor (app/(dashboard)/itens-revisionais/page.tsx) —
// podeCriar/podeEditar/podeExcluir só refletem esse resultado aqui, nunca
// uma checagem paralela (AD-2).
//
// Busca e filtro de status são 100% client-side sobre a lista já carregada
// (Boundaries: nenhuma Server Action é chamada ao alternar filtro/busca).
export function TabelaItens({
  itens,
  podeCriar,
  podeEditar,
  podeExcluir,
}: {
  itens: ItemRevisionalListagem[];
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<"all" | StatusItemRevisional>("all");

  const fecharLinha = () => setLinhaAberta(null);

  const buscaNormalizada = busca.trim().toLowerCase();
  const itensFiltrados = itens.filter((item) => {
    const combinaBusca =
      !buscaNormalizada ||
      item.nome.toLowerCase().includes(buscaNormalizada) ||
      (item.descricao?.toLowerCase().includes(buscaNormalizada) ?? false);
    const combinaStatus = statusFiltro === "all" || item.status === statusFiltro;
    return combinaBusca && combinaStatus;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Itens revisionais</h1>
          <p>Verificações e tarefas que compõem os planos revisionais, com seu controle de medição.</p>
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
          Novo item
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar item revisional"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
        <select
          className="status-select"
          value={statusFiltro}
          onChange={(evento) =>
            setStatusFiltro(evento.target.value as "all" | StatusItemRevisional)
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
              <th>Item revisional</th>
              <th>Descrição</th>
              <th>Controle de medição</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {linhaAberta === "create" && podeCriar ? (
              <LinhaCriacao onFechar={fecharLinha} onSucesso={fecharLinha} />
            ) : null}

            {itensFiltrados.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhum item revisional encontrado.
                </td>
              </tr>
            ) : null}

            {itensFiltrados.map((item) => {
              const badge = BADGE_POR_STATUS[item.status];
              return (
                <Fragment key={item.id}>
                  <tr data-row>
                    <td>
                      <div className="primary-text">{item.nome}</div>
                    </td>
                    <td className="muted">{item.descricao ?? "—"}</td>
                    <td>
                      <div className="perm-badges">
                        {badgesDeControle(item).map((label) => (
                          <StatusBadge key={label} tom="neutral" label={label} />
                        ))}
                      </div>
                    </td>
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
                            setLinhaAberta((atual) => (atual === item.id ? null : item.id))
                          }
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                        {podeExcluir ? (
                          <BotaoExcluir item={item} onSucesso={fecharLinha} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {linhaAberta === item.id && podeEditar ? (
                    <LinhaEdicao item={item} onFechar={fecharLinha} onSucesso={fecharLinha} />
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
