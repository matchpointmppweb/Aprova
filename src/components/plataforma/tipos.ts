import type { PlanoContratado, StatusConta } from "@prisma/client";

// Forma mínima usada pela tabela/linhas de Contas — estruturalmente
// compatível com o retorno de listarContas() (server/repositories/conta.ts),
// sem acoplar os componentes client ao tipo gerado pelo Prisma.
export interface ContaListagem {
  id: string;
  nome: string;
  cnpj: string;
  planoContratado: PlanoContratado;
  status: StatusConta;
  _count: { usuarios: number };
}
