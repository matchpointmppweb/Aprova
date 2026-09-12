"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { StatusBadge, type TomBadge } from "@/src/components/shared/status-badge";
import { excluirPlanoAction } from "@/src/server/actions/plano";
import { estadoInicialAcaoPlano } from "@/src/server/actions/plano-estado";
import { ModalPlano } from "./modal-plano";
import type {
  AtivoOpcao,
  ItemRevisionalOpcao,
  PlanoListagem,
  TipoAtivoOpcao,
  UsuarioOpcao,
} from "./tipos";

type FiltroStatus = "all" | "no-prazo" | "vence-em-breve";

function obterIniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

// Mesmo padrão de formatação de src/components/usuarios/tabela-usuarios.tsx
// (formatarUltimoAcesso), sem hora — Próxima revisão é só data (DD/MM/YYYY).
function formatarData(data: Date | string | null) {
  if (!data) return "—";
  const dataObj = typeof data === "string" ? new Date(data) : data;
  return dataObj.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function vinculadoA(plano: PlanoListagem) {
  if (plano.ativo) return plano.ativo.nome;
  if (plano.tipoAtivo) return `${plano.tipoAtivo.nome} (tipo)`;
  return "—";
}

function contagemItens(plano: PlanoListagem) {
  const total = plano.itens.length;
  return total === 1 ? "1 item" : `${total} itens`;
}

// Ação de excluir isolada num form próprio — mesmo padrão de
// src/components/itens-revisionais/tabela-itens.tsx (BotaoExcluir/
// BotaoExcluirSubmit): confirm() nativo antes de submeter um form oculto que
// chama excluirPlanoAction, cujo gate can(...,'excluir',...) nunca
// reaproveita o de can(...,'editar',...) (Boundaries/AD-2). Só é renderizado
// quando podeExcluir (checado no servidor, app/(dashboard)/
// planos-revisionais/page.tsx) — a UI nunca decide isso sozinha.
function BotaoExcluir({ plano, onSucesso }: { plano: PlanoListagem; onSucesso: () => void }) {
  const [estado, formAction] = useActionState(excluirPlanoAction, estadoInicialAcaoPlano);

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
        if (!window.confirm(`Excluir o plano revisional ${plano.nome}?`)) {
          evento.preventDefault();
        }
      }}
    >
      <input type="hidden" name="planoId" value={plano.id} />
      <BotaoExcluirSubmit />
    </form>
  );
}

// useFormStatus só funciona num componente descendente do <form> — mesmo
// padrão de BotaoExcluirSubmit em tabela-itens.tsx.
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

// Tela Planos revisionais (Story 3.2), portada de Mockup.html:916-943
// (listagem) + :1254-1290/1503-1548 (modal). can() já rodou no servidor
// (app/(dashboard)/planos-revisionais/page.tsx) — podeCriar/podeEditar/
// podeExcluir só refletem esse resultado aqui, nunca uma checagem paralela
// (AD-2).
//
// Busca e filtro de status são 100% client-side sobre a lista já resolvida
// pelo Server Component (proximaData/pendente já vêm calculados via
// resolverAtivosDoPlano, AD-8) — nenhuma Server Action é chamada ao
// alternar filtro/busca. O filtro de status é sobre o badge computado
// ("No prazo"/"Vence em breve"), nunca sobre o enum persistido
// Ativo/Arquivado (Boundaries): planos arquivados já chegam filtrados pela
// página, então nunca aparecem aqui.
export function TabelaPlanos({
  planos,
  ativos,
  tiposAtivo,
  usuarios,
  itensRevisionais,
  podeCriar,
  podeEditar,
  podeExcluir,
}: {
  planos: PlanoListagem[];
  ativos: AtivoOpcao[];
  tiposAtivo: TipoAtivoOpcao[];
  usuarios: UsuarioOpcao[];
  itensRevisionais: ItemRevisionalOpcao[];
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
}) {
  const [modalAberto, setModalAberto] = useState<"create" | string | null>(null);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<FiltroStatus>("all");

  const fecharModal = () => setModalAberto(null);
  const planoEmEdicao =
    modalAberto && modalAberto !== "create"
      ? (planos.find((plano) => plano.id === modalAberto) ?? null)
      : null;

  const buscaNormalizada = busca.trim().toLowerCase();
  const planosFiltrados = planos.filter((plano) => {
    const combinaBusca =
      !buscaNormalizada ||
      plano.nome.toLowerCase().includes(buscaNormalizada) ||
      vinculadoA(plano).toLowerCase().includes(buscaNormalizada) ||
      plano.responsavel.nome.toLowerCase().includes(buscaNormalizada);
    const combinaStatus =
      statusFiltro === "all" ||
      (statusFiltro === "vence-em-breve" && plano.pendente) ||
      (statusFiltro === "no-prazo" && !plano.pendente);
    return combinaBusca && combinaStatus;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Planos revisionais</h1>
          <p>
            Regras de periodicidade de revisão vinculadas a ativos ou tipos, com os itens que
            compõem cada plano.
          </p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!podeCriar}
          onClick={() => setModalAberto("create")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Novo plano
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar por plano, vínculo ou responsável"
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
          />
        </div>
        <select
          className="status-select"
          value={statusFiltro}
          onChange={(evento) => setStatusFiltro(evento.target.value as FiltroStatus)}
        >
          <option value="all">Status: Todos</option>
          <option value="no-prazo">No prazo</option>
          <option value="vence-em-breve">Vence em breve</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Plano</th>
              <th>Vinculado a</th>
              <th>Itens revisionais</th>
              <th>Próxima revisão</th>
              <th>Responsável</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {planosFiltrados.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhum plano revisional encontrado.
                </td>
              </tr>
            ) : null}

            {planosFiltrados.map((plano) => {
              const badge: { tom: TomBadge; label: string } = plano.pendente
                ? { tom: "warn", label: "Vence em breve" }
                : { tom: "ok", label: "No prazo" };
              return (
                <tr data-row key={plano.id}>
                  <td>
                    <div className="primary-text">{plano.nome}</div>
                  </td>
                  <td className="muted">{vinculadoA(plano)}</td>
                  <td>{contagemItens(plano)}</td>
                  <td>{formatarData(plano.proximaData)}</td>
                  <td className="cell-user">
                    <div className="avatar-sm">{obterIniciais(plano.responsavel.nome)}</div>
                    {plano.responsavel.nome}
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
                        onClick={() => setModalAberto(plano.id)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                      </button>
                      {podeExcluir ? <BotaoExcluir plano={plano} onSucesso={fecharModal} /> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modalAberto === "create" && podeCriar ? (
        <ModalPlano
          plano={null}
          ativos={ativos}
          tiposAtivo={tiposAtivo}
          usuarios={usuarios}
          itensRevisionais={itensRevisionais}
          onFechar={fecharModal}
          onSucesso={fecharModal}
        />
      ) : null}
      {planoEmEdicao && podeEditar ? (
        <ModalPlano
          plano={planoEmEdicao}
          ativos={ativos}
          tiposAtivo={tiposAtivo}
          usuarios={usuarios}
          itensRevisionais={itensRevisionais}
          onFechar={fecharModal}
          onSucesso={fecharModal}
        />
      ) : null}
    </>
  );
}
