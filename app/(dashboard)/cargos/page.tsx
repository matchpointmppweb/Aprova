import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaCargos } from "@/src/components/cargos/tabela-cargos";
import type { CargoListagem } from "@/src/components/cargos/tipos";
import { listarCargos } from "@/src/server/repositories/cargo";

export const metadata: Metadata = {
  title: "Cargos — Raiz",
};

// Server Component (Story 5.3): busca listarCargos + can(), e repassa para
// a tabela client-side. can() roda aqui, no servidor, e a UI usa o mesmo
// resultado para esconder/desabilitar criar/editar — nunca uma checagem
// paralela (AD-2). Mesmo padrão de app/(dashboard)/locais/page.tsx.
export default async function CargosPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [cargos, podeCriar, podeEditar] = await Promise.all([
    listarCargos(usuarioSessao.contaId),
    can(usuarioSessao, "criar", "cargos"),
    can(usuarioSessao, "editar", "cargos"),
  ]);

  const cargosListagem: CargoListagem[] = cargos.map((cargo) => ({
    id: cargo.id,
    descricao: cargo.descricao,
    status: cargo.status,
  }));

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Cadastros / <b>Cargos</b>
      </div>

      <TabelaCargos cargos={cargosListagem} podeCriar={podeCriar} podeEditar={podeEditar} />
    </section>
  );
}
