import type { StatusAtivo, StatusEmissao, StatusItemRevisional, StatusPlanoRevisional } from "@prisma/client";

import type { TomBadge } from "@/src/components/shared/status-badge";

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
  // Preenchido só a partir de uma reprovação (Story 4.2); continua null
  // para emissões que nunca foram reprovadas. Sobrevive a um reenvio
  // (voltar a EmAnalise) — só uma nova reprovação futura o sobrescreve.
  motivoReprovacao: string | null;
  itens: ItemExecutadoListagem[];
  updatedAt: Date;
}

// Badge de status da Emissão (Story 4.1: tabela; Story 4.2: reusado também
// no bloco Status do ModalEmissao — Code Map, "reusar StatusBadge/mapa de
// tabela-emissao.tsx"). Vive em tipos.ts (em vez de em tabela-emissao.tsx,
// que importa ModalEmissao) para as duas telas reusarem a mesma constante
// sem criar um import circular entre tabela-emissao.tsx e modal-emissao.tsx.
export const BADGE_POR_STATUS: Record<StatusEmissao, { tom: TomBadge; label: string }> = {
  Rascunho: { tom: "neutral", label: "Rascunho" },
  EmAnalise: { tom: "warn", label: "Em análise" },
  Emitido: { tom: "ok", label: "Emitido" },
  Reprovado: { tom: "off", label: "Reprovado" },
};

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
