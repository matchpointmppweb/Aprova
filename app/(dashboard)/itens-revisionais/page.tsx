import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaItens } from "@/src/components/itens-revisionais/tabela-itens";
import { listarItensRevisionais } from "@/src/server/repositories/item-revisional";

export const metadata: Metadata = {
  title: "Itens revisionais — Raiz",
};

// Server Component (Story 3.1): busca listarItensRevisionais + os 3 gates
// de can(), e repassa tudo para a tabela client-side. can() roda aqui, no
// servidor, e a UI usa o mesmo resultado para esconder/desabilitar
// criar/editar/excluir — nunca uma checagem paralela (AD-2). "Excluir" é um
// gate independente de "editar" (nunca reaproveitado) — mesmo padrão de
// app/(dashboard)/ativos/page.tsx (Story 2.2).
export default async function ItensRevisionaisPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [itens, podeCriar, podeEditar, podeExcluir] = await Promise.all([
    listarItensRevisionais(usuarioSessao.contaId),
    can(usuarioSessao, "criar", "itens"),
    can(usuarioSessao, "editar", "itens"),
    can(usuarioSessao, "excluir", "itens"),
  ]);

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Cadastros / <b>Itens revisionais</b>
      </div>

      <TabelaItens
        itens={itens}
        podeCriar={podeCriar}
        podeEditar={podeEditar}
        podeExcluir={podeExcluir}
      />
    </section>
  );
}
