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
  /// Empresa proprietária (Frente A) — `null` para o ativo sem dona
  /// cadastrada, que continua sendo um ativo válido.
  empresaId: string | null;
  empresa: { razaoSocial: string } | null;
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

// Forma mínima da Empresa usada para popular o <select> de proprietária nos
// formulários de criar/editar — compatível com listarEmpresas(contaId), que
// traz vários campos não usados aqui. Sem `status`: Empresa não tem coluna
// de status (AD-17), então toda empresa cadastrada é sempre selecionável.
export interface EmpresaOpcao {
  id: string;
  razaoSocial: string;
}
