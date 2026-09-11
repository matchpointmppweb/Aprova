import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaTipos } from "@/src/components/tipos-ativo/tabela-tipos";
import { listarTiposAtivo } from "@/src/server/repositories/tipo-ativo";

export const metadata: Metadata = {
  title: "Tipos de ativo — Raiz",
};

// Server Component (Story 2.1): busca listarTiposAtivo + can(), e repassa
// para a tabela client-side. can() roda aqui, no servidor, e a UI usa o
// mesmo resultado para esconder/desabilitar criar/editar — nunca uma
// checagem paralela (AD-2). Mesmo padrão de app/(dashboard)/usuarios/page.tsx.
export default async function TiposPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [tipos, podeCriar, podeEditar] = await Promise.all([
    listarTiposAtivo(usuarioSessao.contaId),
    can(usuarioSessao, "criar", "tipos"),
    can(usuarioSessao, "editar", "tipos"),
  ]);

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Cadastros / <b>Tipos</b>
      </div>

      <TabelaTipos tipos={tipos} podeCriar={podeCriar} podeEditar={podeEditar} />
    </section>
  );
}
