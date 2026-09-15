// Forma mínima usada pela tabela/linhas de Pessoas — estruturalmente
// compatível com o retorno de listarPessoas() (server/repositories/
// pessoa.ts), sem acoplar os componentes client ao tipo gerado pelo Prisma.
// Mesmo padrão de src/components/empresas/tipos.ts. Sem `status`
// (Boundaries/AD-17/AD-18 — Pessoa não tem esse campo). `cargoNome`/
// `funcaoNome` já vêm resolvidos pela página (via include do repositório) —
// a tabela nunca exibe o id cru do Cargo/Função (I/O Matrix).
export interface PessoaListagem {
  id: string;
  nome: string;
  cpf: string;
  cargoId: string;
  cargoNome: string;
  funcaoId: string;
  funcaoNome: string;
  observacao: string | null;
}

// Opção mínima usada pelos <select> de Cargo/Função do formulário —
// alimentados por listarCargos(contaId)/listarFuncoes(contaId) (Story 5.3),
// passados pela página já carregados (Code Map).
export interface OpcaoReferencia {
  id: string;
  descricao: string;
  /// Um Cargo/Função inativado (Story 5.3) some das opções de criação, mas
  /// continua selecionável na edição de uma Pessoa já vinculada a ele —
  /// mesmo padrão de modal-plano.tsx/modal-emissao.tsx, que filtram por
  /// status === "Ativo" preservando o valor já escolhido.
  status: "Ativo" | "Inativo";
}
