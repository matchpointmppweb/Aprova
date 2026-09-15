import type { StatusLocal } from "@prisma/client";

import type { PontoMapa } from "./mapa-editor";

// Forma mínima usada pela tabela/linhas de Locais — estruturalmente
// compatível com o retorno de listarLocais() (server/repositories/local.ts),
// sem acoplar os componentes client ao tipo gerado pelo Prisma. Mesmo padrão
// de src/components/tipos-ativo/tipos.ts.
export interface LocalListagem {
  id: string;
  nome: string;
  endereco: string;
  areaPoligono: PontoMapa[] | null;
  status: StatusLocal;
}
