import type { Modulo } from "@prisma/client";

// Forma mínima usada pela tabela/modal de Perfil de acesso — estruturalmente
// compatível com o retorno de listarPerfisAcessoCompleto()
// (server/repositories/perfil-acesso.ts), sem acoplar os componentes client
// ao tipo gerado pelo Prisma.
export interface PermissaoListagem {
  modulo: Modulo;
  criar: boolean;
  editar: boolean;
  excluir: boolean;
}

export interface PerfilAcessoListagem {
  id: string;
  nome: string;
  descricao: string | null;
  _count: { usuarios: number };
  permissoes: PermissaoListagem[];
}
