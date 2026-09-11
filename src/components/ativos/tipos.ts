import type { StatusAtivo } from "@prisma/client";

// Forma mínima usada pela tabela/linhas de Ativos — estruturalmente
// compatível com o retorno de listarAtivos() (server/repositories/
// ativo.ts), sem acoplar os componentes client ao tipo gerado pelo Prisma.
export interface AtivoListagem {
  id: string;
  codigo: string;
  nome: string;
  tipoAtivoId: string;
  tipoAtivo: { nome: string };
  localizacao: string;
  numeroSerie: string | null;
  status: StatusAtivo;
}

// Forma mínima do Tipo usada para popular o <select> dos formulários de
// criar/editar — compatível com o retorno de listarTiposAtivo() (Story 2.1),
// que já inclui _count e outros campos não usados aqui.
export interface TipoAtivoOpcao {
  id: string;
  nome: string;
}
