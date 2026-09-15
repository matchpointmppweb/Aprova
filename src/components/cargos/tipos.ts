import type { StatusCargo } from "@prisma/client";

// Forma mínima usada pela tabela/linhas de Cargos — estruturalmente
// compatível com o retorno de listarCargos() (server/repositories/cargo.ts),
// sem acoplar os componentes client ao tipo gerado pelo Prisma. Mesmo padrão
// de src/components/locais/tipos.ts.
export interface CargoListagem {
  id: string;
  descricao: string;
  status: StatusCargo;
}
