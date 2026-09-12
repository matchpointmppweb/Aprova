import type { Metadata } from "next";
import Link from "next/link";

import { BADGE_POR_STATUS } from "@/src/components/emissao/tipos";
import { StatusBadge } from "@/src/components/shared/status-badge";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { listarAtivos } from "@/src/server/repositories/ativo";
import { listarEmissoes } from "@/src/server/repositories/emissao";
import {
  listarPlanos,
  MS_POR_DIA,
  resolverAtivosDoPlano,
  type ResolucaoAtivoDoPlano,
} from "@/src/server/repositories/plano";

export const metadata: Metadata = {
  title: "Início — Raiz",
};

// "Próximas revisões"/"Últimas emissões" mostram as N mais próximas/recentes
// (Boundaries: N=5), não uma paginação completa.
const LIMITE_LISTA = 5;

// Texto relativo de "Próximas revisões" (Design Notes) — diferença em dias
// de calendário entre proximaData e hoje, com variante "Venceu há N dias" se
// negativo: o painel mostra as N soonest mesmo além da janela de 7 dias de
// "pendente" (Boundaries), então uma data já vencida pode aparecer aqui. É só
// formatação de texto sobre o dado já existente, não um novo estado.
function formatarPrazo(proximaData: Date, agora: Date): string {
  const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const inicioData = new Date(
    proximaData.getFullYear(),
    proximaData.getMonth(),
    proximaData.getDate(),
  );
  const dias = Math.round((inicioData.getTime() - inicioHoje.getTime()) / MS_POR_DIA);

  if (dias === 0) return "Vence hoje";
  if (dias > 0) return `Vence em ${dias} ${dias === 1 ? "dia" : "dias"}`;
  const atraso = Math.abs(dias);
  return `Venceu há ${atraso} ${atraso === 1 ? "dia" : "dias"}`;
}

function IconeCalendario() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function IconeEnvio() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

// Painel inicial (CAP-6, Story 4.3): Server Component puro — sem
// "use client", sem forms — que só compõe listarAtivos/listarPlanos/
// listarEmissoes/resolverAtivosDoPlano já existentes (Boundaries: nenhuma
// query nova/raw Prisma aqui). resolverAtivosDoPlano é chamado sem planoId
// (conta inteira, AD-8) — única via de pendência/próxima data. Sem gate
// can(): CAP-6 não lista nenhuma chave Modulo de painel, só
// exigirUsuarioAutenticado() (Boundaries).
export default async function InicioPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();
  const contaId = usuarioSessao.contaId;
  const agora = new Date();

  const [ativos, planos, emissoes, resolucoes] = await Promise.all([
    listarAtivos(contaId),
    listarPlanos(contaId),
    listarEmissoes(contaId),
    resolverAtivosDoPlano(contaId),
  ]);

  const ativoPorId = new Map(ativos.map((ativo) => [ativo.id, ativo]));
  const planoPorId = new Map(planos.map((plano) => [plano.id, plano]));

  // "Emissões no mês" (KPI): dataEmissao cai no mês/ano corrente da data do
  // servidor (Boundaries) — não é "criadas nos últimos 30 dias".
  const emissoesNoMes = emissoes.filter(
    (emissao) =>
      emissao.dataEmissao.getFullYear() === agora.getFullYear() &&
      emissao.dataEmissao.getMonth() === agora.getMonth(),
  ).length;

  // "Revisões pendentes" (KPI): contagem de linhas de resolverAtivosDoPlano
  // com pendente===true — uma linha por par ativo×plano resolvido, um ativo
  // coberto por 2 planos pendentes conta 2 vezes (Boundaries).
  const revisoesPendentes = resolucoes.filter((resolucao) => resolucao.pendente).length;

  // "Próximas revisões" (painel): as N linhas com proximaData não-nula,
  // ordenadas crescente, SEM filtrar por pendente (Boundaries) — mostra o
  // que vem a seguir, não só o que já está "vence em breve".
  const proximasRevisoes = resolucoes
    .filter(
      (resolucao): resolucao is ResolucaoAtivoDoPlano & { proximaData: Date } =>
        resolucao.proximaData !== null,
    )
    .sort((a, b) => a.proximaData.getTime() - b.proximaData.getTime())
    .slice(0, LIMITE_LISTA);

  // "Últimas emissões" (painel): as primeiras N de listarEmissoes, já
  // ordenado por ano/seq decrescente (mais recente primeiro) — Boundaries.
  const ultimasEmissoes = emissoes.slice(0, LIMITE_LISTA);

  return (
    <section className="page">
      <div className="crumb">
        Raiz / <b>Início</b>
      </div>
      <div className="page-head">
        <div>
          <h1>Olá, {usuarioSessao.nome}</h1>
          <p>Este é o panorama geral dos seus ativos e emissões.</p>
        </div>
        <Link className="btn btn-primary" href="/emissao">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nova emissão
        </Link>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <div className="k-label">Ativos cadastrados</div>
          <div className="k-value">{ativos.length.toLocaleString("pt-BR")}</div>
        </div>
        <div className="kpi">
          <div className="k-label">Planos revisionais ativos</div>
          <div className="k-value">
            {planos.filter((plano) => plano.status === "Ativo").length.toLocaleString("pt-BR")}
          </div>
        </div>
        <div className="kpi">
          <div className="k-label">Emissões no mês</div>
          <div className="k-value">{emissoesNoMes.toLocaleString("pt-BR")}</div>
        </div>
        <div className="kpi">
          <div className="k-label">Revisões pendentes</div>
          <div className="k-value">{revisoesPendentes.toLocaleString("pt-BR")}</div>
        </div>
      </div>

      <div className="panel-grid">
        <div className="panel">
          <div className="panel-head">
            <h3>Próximas revisões</h3>
            <Link href="/planos-revisionais">Ver planos revisionais</Link>
          </div>
          <div className="panel-body">
            {proximasRevisoes.length === 0 ? (
              <p className="muted">Nada por aqui ainda.</p>
            ) : (
              proximasRevisoes.map((resolucao) => {
                const ativo = ativoPorId.get(resolucao.ativoId);
                const plano = planoPorId.get(resolucao.planoId);
                return (
                  <div className="mini-row" key={`${resolucao.ativoId}-${resolucao.planoId}`}>
                    <div className="icon-sq">
                      <IconeCalendario />
                    </div>
                    <div className="txt">
                      <div className="t1">{ativo?.nome ?? "Ativo"}</div>
                      <div className="t2">Plano: {plano?.nome ?? "—"}</div>
                    </div>
                    <div className="side">{formatarPrazo(resolucao.proximaData, agora)}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Últimas emissões</h3>
            <Link href="/emissao">Ver todas</Link>
          </div>
          <div className="panel-body">
            {ultimasEmissoes.length === 0 ? (
              <p className="muted">Nada por aqui ainda.</p>
            ) : (
              ultimasEmissoes.map((emissao) => {
                const badge = BADGE_POR_STATUS[emissao.status];
                return (
                  <div className="mini-row" key={emissao.id}>
                    <div className="icon-sq">
                      <IconeEnvio />
                    </div>
                    <div className="txt">
                      <div className="t1">{emissao.codigo}</div>
                      <div className="t2">{emissao.ativo.nome}</div>
                    </div>
                    <div className="side">
                      <StatusBadge tom={badge.tom} label={badge.label} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
