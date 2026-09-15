import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaPessoas } from "@/src/components/pessoas/tabela-pessoas";
import type { OpcaoReferencia, PessoaListagem } from "@/src/components/pessoas/tipos";
import { listarCargos } from "@/src/server/repositories/cargo";
import { listarFuncoes } from "@/src/server/repositories/funcao";
import { listarPessoas } from "@/src/server/repositories/pessoa";

export const metadata: Metadata = {
  title: "Pessoas — Raiz",
};

// Server Component (Story 5.4): busca listarPessoas + listarCargos/
// listarFuncoes (para alimentar os <select> de Cargo/Função) + can(), e
// repassa tudo para a tabela client-side. can() roda aqui, no servidor, e a
// UI usa o mesmo resultado para esconder/desabilitar criar/editar — nunca
// uma checagem paralela (AD-2). Mesmo padrão de
// app/(dashboard)/empresas/page.tsx.
export default async function PessoasPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [pessoas, cargos, funcoes, podeCriar, podeEditar] = await Promise.all([
    listarPessoas(usuarioSessao.contaId),
    listarCargos(usuarioSessao.contaId),
    listarFuncoes(usuarioSessao.contaId),
    can(usuarioSessao, "criar", "pessoas"),
    can(usuarioSessao, "editar", "pessoas"),
  ]);

  const pessoasListagem: PessoaListagem[] = pessoas.map((pessoa) => ({
    id: pessoa.id,
    nome: pessoa.nome,
    cpf: pessoa.cpf,
    cargoId: pessoa.cargoId,
    cargoNome: pessoa.cargo.descricao,
    funcaoId: pessoa.funcaoId,
    funcaoNome: pessoa.funcao.descricao,
    observacao: pessoa.observacao,
  }));

  const cargosOpcoes: OpcaoReferencia[] = cargos.map((cargo) => ({
    id: cargo.id,
    descricao: cargo.descricao,
    status: cargo.status,
  }));
  const funcoesOpcoes: OpcaoReferencia[] = funcoes.map((funcao) => ({
    id: funcao.id,
    descricao: funcao.descricao,
    status: funcao.status,
  }));

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Cadastros / <b>Pessoas</b>
      </div>

      <TabelaPessoas
        pessoas={pessoasListagem}
        cargos={cargosOpcoes}
        funcoes={funcoesOpcoes}
        podeCriar={podeCriar}
        podeEditar={podeEditar}
      />
    </section>
  );
}
