import type {
  ModoLancamentoServico,
  Setor,
  StatusAtivo,
  StatusEmissao,
  StatusItemRevisional,
  StatusPlanoRevisional,
} from "@prisma/client";

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

// Linha da aba "Serviço" (Story 5.5) — compatível com o `servicos` incluído
// por listarEmissoes()/buscarEmissao(). Sem contaId próprio: o escopo vem da
// Emissão pai.
export interface ServicoEmissaoListagem {
  id: string;
  pessoaId: string;
  itemRevisionalId: string;
  inicio: Date | null;
  fim: Date | null;
  // Story 7.1: modo sempre preenchido (default no banco cobre as linhas
  // criadas antes da migration); `duracaoMinutos` é minuto inteiro, só no
  // modo `Duracao` — "1:55" é formato de tela (7.2), nunca de armazenamento.
  // Nenhuma tela lê os dois campos ainda: a exibição é da 7.3/7.4.
  modo: ModoLancamentoServico;
  duracaoMinutos: number | null;
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
  // Story 5.5: setor sempre preenchido (default no banco cobre as emissões
  // criadas antes da migration); os três marcos de data/hora são opcionais.
  setor: Setor;
  dataAgendamento: Date | null;
  dataInicio: Date | null;
  dataFim: Date | null;
  status: StatusEmissao;
  // Preenchido só a partir de uma reprovação (Story 4.2); continua null
  // para emissões que nunca foram reprovadas. Sobrevive a um reenvio
  // (voltar a EmAnalise) — só uma nova reprovação futura o sobrescreve.
  motivoReprovacao: string | null;
  itens: ItemExecutadoListagem[];
  servicos: ServicoEmissaoListagem[];
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
  // Story 7.5: o tipo do ativo é o SEGUNDO nível de preferência de
  // `derivarPlanoDoAtivo` (AD-32) — sem ele o cliente não deriva o plano e o
  // checklist da aba Itens não tem de onde nascer. `listarAtivos` já traz o
  // valor (findMany sem select); só o tipo o escondia.
  tipoAtivoId: string;
}

// Item de PlanoItemRevisional do plano vigente — o formato que
// `listarPlanos()` (server/repositories/plano.ts) traz em `itens` via
// INCLUDE_LISTAGEM, e que chega ao modal dentro de `PlanoOpcao`. Usado pelo
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
  // Story 7.5: os dois lados do vínculo XOR do plano (AD-32) — é por eles que
  // `derivarPlanoDoAtivo` decide. `listarPlanos` já os traz; só o tipo os
  // escondia (mesmo caso da `descricao` na 7.4).
  ativoId: string | null;
  tipoAtivoId: string | null;
  itens: PlanoItemVigente[];
}

export interface UsuarioOpcao {
  id: string;
  nome: string;
}

// Forma mínima usada pelo <select> de Pessoa de cada linha de serviço
// (Story 5.5) — compatível com listarPessoas(). Pessoa não tem `status`
// (AD-17/AD-18), então não há filtro de ativos/inativos aqui.
export interface PessoaOpcao {
  id: string;
  nome: string;
}

// Forma mínima usada para resolver nome/controles de cada linha do
// checklist de itens (a partir do itemRevisionalId) — compatível com
// listarItensRevisionais().
export interface ItemRevisionalOpcao {
  id: string;
  nome: string;
  // A coluna "Descrição" da aba Itens (Story 7.4) exibe este valor — ele já
  // vinha de listarItensRevisionais() (findMany sem select), só não estava
  // declarado aqui.
  descricao: string | null;
  diasPadrao: number | null;
  kmPadrao: number | null;
  horasPadrao: number | null;
  status: StatusItemRevisional;
}
