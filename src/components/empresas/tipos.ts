// Forma mínima usada pela tabela/linhas de Empresas — estruturalmente
// compatível com o retorno de listarEmpresas() (server/repositories/
// empresa.ts), sem acoplar os componentes client ao tipo gerado pelo Prisma.
// Mesmo padrão de src/components/locais/tipos.ts. Sem `status` (Boundaries/
// AD-17 — Empresa não tem esse campo).
export interface EmpresaListagem {
  id: string;
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string | null;
  cpf: string | null;
  observacao: string | null;
}
