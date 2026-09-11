import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaPerfis } from "@/src/components/perfil-acesso/tabela-perfis";
import { listarPerfisAcessoCompleto } from "@/src/server/repositories/perfil-acesso";

export const metadata: Metadata = {
  title: "Perfil de acesso — Raiz",
};

// Server Component (CAP-9): busca listarPerfisAcessoCompleto + can(), e
// repassa para a tabela client-side. can() roda aqui, no servidor, e a UI
// usa o mesmo resultado para esconder/desabilitar criar/editar — nunca uma
// checagem paralela (AD-2). Mesmo padrão de app/(dashboard)/usuarios/page.tsx.
export default async function PerfilAcessoPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [perfis, podeCriar, podeEditar] = await Promise.all([
    listarPerfisAcessoCompleto(usuarioSessao.contaId),
    can(usuarioSessao, "criar", "perfil"),
    can(usuarioSessao, "editar", "perfil"),
  ]);

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Configurações / <b>Perfil de acesso</b>
      </div>

      <TabelaPerfis perfis={perfis} podeCriar={podeCriar} podeEditar={podeEditar} />
    </section>
  );
}
