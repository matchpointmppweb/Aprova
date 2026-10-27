"use client";

import { useState } from "react";

import { formatarInstante } from "@/src/lib/datas";
import { StatusBadge } from "@/src/components/shared/status-badge";
import { LABEL_POR_SETOR } from "@/src/server/actions/emissao-estado";
import { ModalEmissao } from "./modal-emissao";
import { BADGE_POR_STATUS } from "./tipos";
import type {
  AtivoOpcao,
  EmissaoListagem,
  ItemRevisionalOpcao,
  PessoaOpcao,
  PlanoOpcao,
  UsuarioOpcao,
} from "./tipos";

type FiltroStatus = "all" | "rascunho" | "em-analise" | "emitido" | "reprovado";

const FILTRO_POR_STATUS: Record<Exclude<FiltroStatus, "all">, EmissaoListagem["status"]> = {
  rascunho: "Rascunho",
  "em-analise": "EmAnalise",
  emitido: "Emitido",
  reprovado: "Reprovado",
};

function obterIniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return (primeira + ultima).toUpperCase();
}

// Diferido da Story 7.5, fechado em 27-10-2026: a coluna chamava-se "Data"
// e mostrava só o dia, enquanto a AD-33 mudou a NATUREZA do campo — deixou
// de ser data de negócio digitável e passou a ser o instante em que o
// servidor criou a emissão, exibido no modal como "Data criação" com hora.
// Rótulo e granularidade agora batem nos dois lugares; ler "12/10" na lista
// e "12/10 14:37" no modal fazia parecer campos diferentes.
//
// Usa `formatarInstante` de src/lib/datas.ts — a mesma função do modal e da
// OS impressa, com getters LOCAIS porque é instante real, não relógio de
// parede digitado.

// Tela Emissão (Story 4.1), portada de Mockup.html:945-979 (listagem) +
// :1294-1331/1564-1585 (modal). can() já rodou no servidor (app/(dashboard)/
// emissao/page.tsx) — podeCriar/podeEditar só refletem esse resultado aqui,
// nunca uma checagem paralela (AD-2). Sem ação de excluir nesta story
// (Boundaries/Never — gap deferido em deferred-work.md).
//
// Busca e filtro de status são 100% client-side sobre a lista já resolvida
// pelo Server Component — nenhuma Server Action é chamada ao alternar
// filtro/busca.
export function TabelaEmissao({
  emissoes,
  ativos,
  planos,
  usuarios,
  itensRevisionais,
  pessoas,
  podeCriar,
  podeEditar,
}: {
  emissoes: EmissaoListagem[];
  ativos: AtivoOpcao[];
  planos: PlanoOpcao[];
  usuarios: UsuarioOpcao[];
  itensRevisionais: ItemRevisionalOpcao[];
  pessoas: PessoaOpcao[];
  podeCriar: boolean;
  podeEditar: boolean;
}) {
  const [modalAberto, setModalAberto] = useState<"create" | string | null>(null);
  const [busca, setBusca] = useState("");
  const [statusFiltro, setStatusFiltro] = useState<FiltroStatus>("all");

  const fecharModal = () => setModalAberto(null);
  const emissaoEmEdicao =
    modalAberto && modalAberto !== "create"
      ? (emissoes.find((emissao) => emissao.id === modalAberto) ?? null)
      : null;

  const buscaNormalizada = busca.trim().toLowerCase();
  const emissoesFiltradas = emissoes.filter((emissao) => {
    const combinaBusca =
      !buscaNormalizada ||
      emissao.codigo.toLowerCase().includes(buscaNormalizada) ||
      emissao.ativo.nome.toLowerCase().includes(buscaNormalizada);
    const combinaStatus =
      statusFiltro === "all" || emissao.status === FILTRO_POR_STATUS[statusFiltro];
    return combinaBusca && combinaStatus;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Emissão</h1>
          <p>Documentos de emissão gerados a partir dos planos revisionais.</p>
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
          Nova emissão
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            placeholder="Buscar por nº de emissão ou ativo"
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
          <option value="rascunho">Rascunho</option>
          <option value="em-analise">Em análise</option>
          <option value="emitido">Emitido</option>
          <option value="reprovado">Reprovado</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nº emissão</th>
              <th>Ativo</th>
              <th>Setor</th>
              <th>Plano revisional</th>
              <th>Data criação</th>
              <th>Responsável</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {emissoesFiltradas.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                  Nenhuma emissão encontrada.
                </td>
              </tr>
            ) : null}

            {emissoesFiltradas.map((emissao) => {
              const badge = BADGE_POR_STATUS[emissao.status];
              return (
                <tr data-row key={emissao.id}>
                  <td className="code">{emissao.codigo}</td>
                  <td>{emissao.ativo.nome}</td>
                  <td className="muted">{LABEL_POR_SETOR[emissao.setor]}</td>
                  <td className="muted">{emissao.plano.nome}</td>
                  <td>{formatarInstante(emissao.dataEmissao)}</td>
                  <td className="cell-user">
                    <div className="avatar-sm">{obterIniciais(emissao.responsavel.nome)}</div>
                    {emissao.responsavel.nome}
                  </td>
                  <td>
                    <StatusBadge tom={badge.tom} label={badge.label} />
                  </td>
                  <td>
                    <div className="row-actions">
                      {/* Impressão da OS (C2) — <a> e não <button>: é
                          navegação para outra rota, abre em aba nova para
                          não perder a listagem filtrada, e funciona sem
                          JavaScript. Sem gate de permissão porque não
                          existe ação "ver" no enum; quem enxerga a linha
                          pode imprimi-la. */}
                      <a
                        className="icon-btn"
                        href={`/emissao/${emissao.id}/os`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Imprimir OS"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" />
                        </svg>
                      </a>
                      <button
                        className="icon-btn"
                        type="button"
                        title="Editar"
                        disabled={!podeEditar}
                        onClick={() => setModalAberto(emissao.id)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modalAberto === "create" && podeCriar ? (
        <ModalEmissao
          emissao={null}
          ativos={ativos}
          planos={planos}
          usuarios={usuarios}
          itensRevisionais={itensRevisionais}
          pessoas={pessoas}
          onFechar={fecharModal}
          onSucesso={fecharModal}
        />
      ) : null}
      {emissaoEmEdicao && podeEditar ? (
        <ModalEmissao
          emissao={emissaoEmEdicao}
          ativos={ativos}
          planos={planos}
          usuarios={usuarios}
          itensRevisionais={itensRevisionais}
          pessoas={pessoas}
          onFechar={fecharModal}
          onSucesso={fecharModal}
        />
      ) : null}
    </>
  );
}
