import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaAtivos } from "@/src/components/ativos/tabela-ativos";
import { listarAtivos } from "@/src/server/repositories/ativo";
import { listarTiposAtivo } from "@/src/server/repositories/tipo-ativo";

export const metadata: Metadata = {
  title: "Ativos — Raiz",
};

// Server Component (Story 2.2): busca listarAtivos + listarTiposAtivo (para
// popular o select de Tipo dos formulários com dados reais, Boundaries) +
// os 3 gates de can(), e repassa tudo para a tabela client-side. can() roda
// aqui, no servidor, e a UI usa o mesmo resultado para esconder/desabilitar
// criar/editar/excluir — nunca uma checagem paralela (AD-2). "Excluir" é um
// gate independente de "editar" (nunca reaproveitado), primeiro caso real do
// produto em que os dois divergem para o mesmo usuário (Técnico de
// manutenção). Mesmo padrão de app/(dashboard)/tipos/page.tsx.
export default async function AtivosPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [ativos, tiposAtivo, podeCriar, podeEditar, podeExcluir] = await Promise.all([
    listarAtivos(usuarioSessao.contaId),
    listarTiposAtivo(usuarioSessao.contaId),
    can(usuarioSessao, "criar", "ativos"),
    can(usuarioSessao, "editar", "ativos"),
    can(usuarioSessao, "excluir", "ativos"),
  ]);

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Cadastros / <b>Ativos</b>
      </div>

      <TabelaAtivos
        ativos={ativos}
        tiposAtivo={tiposAtivo}
        podeCriar={podeCriar}
        podeEditar={podeEditar}
        podeExcluir={podeExcluir}
      />
    </section>
  );
}
