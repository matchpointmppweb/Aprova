import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaPlanos } from "@/src/components/planos-revisionais/tabela-planos";
import { listarAtivos } from "@/src/server/repositories/ativo";
import { listarItensRevisionais } from "@/src/server/repositories/item-revisional";
import {
  listarPlanos,
  resolverAtivosDoPlano,
  type ResolucaoAtivoDoPlano,
} from "@/src/server/repositories/plano";
import { listarTiposAtivo } from "@/src/server/repositories/tipo-ativo";
import { listarUsuarios } from "@/src/server/repositories/usuario";

export const metadata: Metadata = {
  title: "Planos revisionais — Raiz",
};

// Agrega resolverAtivosDoPlano (AD-8) por planoId: pendente=true se QUALQUER
// ativo resolvido do plano estiver pendente; proximaData exibida é a MENOR
// entre os ativos resolvidos (o que vence primeiro) — mesma regra usada
// dentro de resolverAtivosDoPlano para um único ativo, só que agora por
// plano inteiro (Code Map).
function agregarPorPlano(resolucoes: ResolucaoAtivoDoPlano[]) {
  const porPlano = new Map<string, { proximaData: Date | null; pendente: boolean }>();

  for (const resolucao of resolucoes) {
    const atual = porPlano.get(resolucao.planoId) ?? { proximaData: null, pendente: false };

    const pendente = atual.pendente || resolucao.pendente;
    let proximaData = atual.proximaData;
    if (resolucao.proximaData !== null) {
      if (proximaData === null || resolucao.proximaData.getTime() < proximaData.getTime()) {
        proximaData = resolucao.proximaData;
      }
    }

    porPlano.set(resolucao.planoId, { proximaData, pendente });
  }

  return porPlano;
}

// Server Component (Story 3.2): busca listarPlanos + resolverAtivosDoPlano
// (agregado por plano) + as opções dos pickers do modal (ativos/tipos/itens/
// usuários) + os 3 gates de can(), e repassa tudo pronto para a tabela.
// can() roda aqui, no servidor, e a UI usa o mesmo resultado para esconder/
// desabilitar criar/editar/excluir — nunca uma checagem paralela (AD-2).
// "Excluir" é um gate independente de "editar" (nunca reaproveitado) — mesmo
// padrão de app/(dashboard)/itens-revisionais/page.tsx (Story 3.1).
//
// Planos com status Arquivado nunca aparecem nesta listagem: o vocabulário
// de Status aqui é só "No prazo"/"Vence em breve" (Boundaries) — não existe
// uma representação de "Arquivado" nesta tabela nem um filtro para ela no
// mockup (Mockup.html:916-943), diferente de Ativos/Itens revisionais, cujo
// enum de status é diretamente editável e exibido.
export default async function PlanosRevisionaisPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [planosTodos, resolucoes, ativos, tiposAtivo, itensRevisionais, usuarios, podeCriar, podeEditar, podeExcluir] =
    await Promise.all([
      listarPlanos(usuarioSessao.contaId),
      resolverAtivosDoPlano(usuarioSessao.contaId),
      listarAtivos(usuarioSessao.contaId),
      listarTiposAtivo(usuarioSessao.contaId),
      listarItensRevisionais(usuarioSessao.contaId),
      listarUsuarios(usuarioSessao.contaId),
      can(usuarioSessao, "criar", "planos"),
      can(usuarioSessao, "editar", "planos"),
      can(usuarioSessao, "excluir", "planos"),
    ]);

  const agregadoPorPlano = agregarPorPlano(resolucoes);

  const planos = planosTodos
    .filter((plano) => plano.status === "Ativo")
    .map((plano) => {
      const agregado = agregadoPorPlano.get(plano.id) ?? { proximaData: null, pendente: false };
      return {
        ...plano,
        proximaData: agregado.proximaData,
        pendente: agregado.pendente,
      };
    });

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Cadastros / <b>Planos revisionais</b>
      </div>

      <TabelaPlanos
        planos={planos}
        ativos={ativos}
        tiposAtivo={tiposAtivo}
        usuarios={usuarios}
        itensRevisionais={itensRevisionais}
        podeCriar={podeCriar}
        podeEditar={podeEditar}
        podeExcluir={podeExcluir}
      />
    </section>
  );
}
