import type { StatusUsuario } from "@prisma/client";

// Forma mínima usada pela tabela/linhas de Usuários — estruturalmente
// compatível com o retorno de listarUsuarios()/listarPerfisAcesso()
// (server/repositories/usuario.ts, perfil-acesso.ts), sem acoplar os
// componentes client ao tipo gerado pelo Prisma.
export interface UsuarioListagem {
  id: string;
  nome: string;
  email: string;
  status: StatusUsuario;
  ultimoAcesso: Date | string | null;
  perfilAcesso: { id: string; nome: string };
}

export interface PerfilAcessoOpcao {
  id: string;
  nome: string;
}
