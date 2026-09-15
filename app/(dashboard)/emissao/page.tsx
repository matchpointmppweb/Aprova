import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaEmissao } from "@/src/components/emissao/tabela-emissao";
import type { PessoaOpcao } from "@/src/components/emissao/tipos";
import { listarAtivos } from "@/src/server/repositories/ativo";
import { listarEmissoes } from "@/src/server/repositories/emissao";
import { listarItensRevisionais } from "@/src/server/repositories/item-revisional";
import { listarPessoas } from "@/src/server/repositories/pessoa";
import { listarPlanos } from "@/src/server/repositories/plano";
import { listarUsuarios } from "@/src/server/repositories/usuario";

export const metadata: Metadata = {
  title: "Emissão — Raiz",
};

// Server Component (Story 4.1): busca listarEmissoes + as opções dos
// pickers do modal (ativos/planos com seus itens vigentes/itens
// revisionais/usuários) + os 2 gates de can() (criar/editar — sem excluir
// nesta story, Boundaries/Never), e repassa tudo pronto para a tabela. can()
// roda aqui, no servidor, e a UI usa o mesmo resultado para esconder/
// desabilitar criar/editar — nunca uma checagem paralela (AD-2). Mesmo
// padrão de app/(dashboard)/planos-revisionais/page.tsx.
export default async function EmissaoPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [emissoes, ativos, planos, itensRevisionais, usuarios, pessoas, podeCriar, podeEditar] =
    await Promise.all([
      listarEmissoes(usuarioSessao.contaId),
      listarAtivos(usuarioSessao.contaId),
      listarPlanos(usuarioSessao.contaId),
      listarItensRevisionais(usuarioSessao.contaId),
      listarUsuarios(usuarioSessao.contaId),
      // Story 5.5: opções do <select> de Pessoa das linhas da aba Serviço.
      listarPessoas(usuarioSessao.contaId),
      can(usuarioSessao, "criar", "emissao"),
      can(usuarioSessao, "editar", "emissao"),
    ]);

  // Projeta no servidor para a forma mínima do <select> (mesmo padrão de
  // app/(dashboard)/pessoas/page.tsx): listarPessoas devolve a linha inteira
  // (CPF, observação, cargo/função incluídos) e o tipo estrutural de
  // PessoaOpcao aceitaria esses campos extras em silêncio, mandando dado
  // pessoal desnecessário para o cliente.
  const pessoasOpcoes: PessoaOpcao[] = pessoas.map((pessoa) => ({
    id: pessoa.id,
    nome: pessoa.nome,
  }));

  return (
    <section className="page">
      <div className="crumb">
        Raiz / <b>Emissão</b>
      </div>

      <TabelaEmissao
        emissoes={emissoes}
        ativos={ativos}
        planos={planos}
        usuarios={usuarios}
        itensRevisionais={itensRevisionais}
        pessoas={pessoasOpcoes}
        podeCriar={podeCriar}
        podeEditar={podeEditar}
      />
    </section>
  );
}
