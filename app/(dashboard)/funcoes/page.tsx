import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaFuncoes } from "@/src/components/funcoes/tabela-funcoes";
import type { FuncaoListagem } from "@/src/components/funcoes/tipos";
import { listarFuncoes } from "@/src/server/repositories/funcao";

export const metadata: Metadata = {
  title: "Funções — Raiz",
};

// Server Component (Story 5.3): busca listarFuncoes + can(), e repassa para
// a tabela client-side. can() roda aqui, no servidor, e a UI usa o mesmo
// resultado para esconder/desabilitar criar/editar — nunca uma checagem
// paralela (AD-2). Mesmo padrão de app/(dashboard)/locais/page.tsx.
export default async function FuncoesPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [funcoes, podeCriar, podeEditar] = await Promise.all([
    listarFuncoes(usuarioSessao.contaId),
    can(usuarioSessao, "criar", "funcoes"),
    can(usuarioSessao, "editar", "funcoes"),
  ]);

  const funcoesListagem: FuncaoListagem[] = funcoes.map((funcao) => ({
    id: funcao.id,
    descricao: funcao.descricao,
    status: funcao.status,
  }));

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Cadastros / <b>Funções</b>
      </div>

      <TabelaFuncoes funcoes={funcoesListagem} podeCriar={podeCriar} podeEditar={podeEditar} />
    </section>
  );
}
