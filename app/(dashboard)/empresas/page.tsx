import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaEmpresas } from "@/src/components/empresas/tabela-empresas";
import type { EmpresaListagem } from "@/src/components/empresas/tipos";
import { listarEmpresas } from "@/src/server/repositories/empresa";

export const metadata: Metadata = {
  title: "Empresas — Raiz",
};

// Server Component (Story 5.2): busca listarEmpresas + can(), e repassa para
// a tabela client-side. can() roda aqui, no servidor, e a UI usa o mesmo
// resultado para esconder/desabilitar criar/editar — nunca uma checagem
// paralela (AD-2). Mesmo padrão de app/(dashboard)/locais/page.tsx.
export default async function EmpresasPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [empresas, podeCriar, podeEditar] = await Promise.all([
    listarEmpresas(usuarioSessao.contaId),
    can(usuarioSessao, "criar", "empresas"),
    can(usuarioSessao, "editar", "empresas"),
  ]);

  const empresasListagem: EmpresaListagem[] = empresas.map((empresa) => ({
    id: empresa.id,
    razaoSocial: empresa.razaoSocial,
    nomeFantasia: empresa.nomeFantasia,
    cnpj: empresa.cnpj,
    cpf: empresa.cpf,
    observacao: empresa.observacao,
  }));

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Cadastros / <b>Empresas</b>
      </div>

      <TabelaEmpresas empresas={empresasListagem} podeCriar={podeCriar} podeEditar={podeEditar} />
    </section>
  );
}
