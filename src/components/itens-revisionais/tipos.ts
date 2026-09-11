import type { StatusItemRevisional } from "@prisma/client";

// Forma mínima usada pela tabela/linhas de Itens revisionais —
// estruturalmente compatível com o retorno de listarItensRevisionais()
// (server/repositories/item-revisional.ts), sem acoplar os componentes
// client ao tipo gerado pelo Prisma.
export interface ItemRevisionalListagem {
  id: string;
  nome: string;
  descricao: string | null;
  diasPadrao: number | null;
  kmPadrao: number | null;
  horasPadrao: number | null;
  status: StatusItemRevisional;
}
