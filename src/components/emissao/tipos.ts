import type { StatusAtivo, StatusEmissao, StatusItemRevisional, StatusPlanoRevisional } from "@prisma/client";

// Forma mínima usada pela tabela/modal de Emissão — estruturalmente
// compatível com o retorno de listarEmissoes()/buscarEmissao() (server/
// repositories/emissao.ts), sem acoplar os componentes client ao tipo
// gerado pelo Prisma. Mesmo padrão de src/components/planos-revisionais/
// tipos.ts.

export interface ItemExecutadoListagem {
  id: string;
  itemRevisionalId: string;
  executado: boolean;
  valorEsperadoDias: number | null;
  valorEsperadoKm: number | null;
  valorEsperadoHoras: number | null;
  medicaoDias: number | null;
  medicaoKm: number | null;
  medicaoHoras: number | null;
  observacao: string | null;
}

export interface EmissaoListagem {
  id: string;
  codigo: string;
  ano: number;
  seq: number;
  ativoId: string;
  ativo: { id: string; nome: string };
  planoId: string;
  plano: { id: string; nome: string };
  responsavelId: string;
  responsavel: { id: string; nome: string };
  dataEmissao: Date;
  status: StatusEmissao;
  itens: ItemExecutadoListagem[];
  updatedAt: Date;
}

export interface AtivoOpcao {
  id: string;
  nome: string;
  status: StatusAtivo;
}

// Item de PlanoItemRevisional do plano vigente — compatível com
// listarPlanos()/buscarPlano() (server/repositories/plano.ts). Usado pelo
// modal para montar o checklist fixo de itens ao criar uma emissão ou ao
// trocar o plano vinculado numa edição (Boundaries/Code Map).
export interface PlanoItemVigente {
  itemRevisionalId: string;
  diasOverride: number | null;
  kmOverride: number | null;
  horasOverride: number | null;
}

export interface PlanoOpcao {
  id: string;
  nome: string;
  status: StatusPlanoRevisional;
  itens: PlanoItemVigente[];
}

export interface UsuarioOpcao {
  id: string;
  nome: string;
}

// Forma mínima usada para resolver nome/controles de cada linha do
// checklist de itens (a partir do itemRevisionalId) — compatível com
// listarItensRevisionais().
export interface ItemRevisionalOpcao {
  id: string;
  nome: string;
  diasPadrao: number | null;
  kmPadrao: number | null;
  horasPadrao: number | null;
  status: StatusItemRevisional;
}
