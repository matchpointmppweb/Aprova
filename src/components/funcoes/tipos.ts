import type { StatusFuncao } from "@prisma/client";

// Forma mínima usada pela tabela/linhas de Funções — estruturalmente
// compatível com o retorno de listarFuncoes()
// (server/repositories/funcao.ts), sem acoplar os componentes client ao
// tipo gerado pelo Prisma. Mesmo padrão de src/components/locais/tipos.ts.
export interface FuncaoListagem {
  id: string;
  descricao: string;
  status: StatusFuncao;
}
