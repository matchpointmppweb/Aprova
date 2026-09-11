import type { StatusTipoAtivo } from "@prisma/client";

// Forma mínima usada pela tabela/linhas de Tipos de ativo — estruturalmente
// compatível com o retorno de listarTiposAtivo() (server/repositories/
// tipo-ativo.ts), sem acoplar os componentes client ao tipo gerado pelo
// Prisma. "Ativos vinculados" não existe aqui: é fixa em 0 nesta story
// (Intent/Boundaries), renderizada direto na tabela em vez de vir dos dados.
export interface TipoAtivoListagem {
  id: string;
  nome: string;
  descricao: string | null;
  status: StatusTipoAtivo;
}
