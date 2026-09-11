import type { StatusTipoAtivo } from "@prisma/client";

// Forma mínima usada pela tabela/linhas de Tipos de ativo — estruturalmente
// compatível com o retorno de listarTiposAtivo() (server/repositories/
// tipo-ativo.ts), sem acoplar os componentes client ao tipo gerado pelo
// Prisma. "Ativos vinculados" passou a ser uma contagem real (Story 2.2,
// include: { _count: { select: { ativos: true } } }).
export interface TipoAtivoListagem {
  id: string;
  nome: string;
  descricao: string | null;
  status: StatusTipoAtivo;
  _count: { ativos: number };
}
