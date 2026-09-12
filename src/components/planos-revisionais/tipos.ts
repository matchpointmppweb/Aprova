import type {
  StatusAtivo,
  StatusItemRevisional,
  StatusPlanoRevisional,
  StatusTipoAtivo,
} from "@prisma/client";

// Forma mínima usada pela tabela/modal de Planos revisionais —
// estruturalmente compatível com o retorno de listarPlanos() (server/
// repositories/plano.ts), sem acoplar os componentes client ao tipo gerado
// pelo Prisma. `proximaData`/`pendente` NUNCA vêm do Prisma — são agregados
// pelo Server Component (app/(dashboard)/planos-revisionais/page.tsx) a
// partir de resolverAtivosDoPlano por planoId (AD-8, Boundaries).

export interface PlanoItemListagem {
  id: string;
  itemRevisionalId: string;
  diasOverride: number | null;
  kmOverride: number | null;
  horasOverride: number | null;
}

export interface PlanoListagem {
  id: string;
  nome: string;
  ativoId: string | null;
  ativo: { id: string; nome: string } | null;
  tipoAtivoId: string | null;
  tipoAtivo: { id: string; nome: string } | null;
  responsavelId: string;
  responsavel: { id: string; nome: string };
  status: StatusPlanoRevisional;
  itens: PlanoItemListagem[];
  updatedAt: Date;
  /// Agregado pela página: MENOR proximaData entre os ativos resolvidos
  /// deste plano (null se nenhum ativo resolvido tiver proximaData).
  proximaData: Date | null;
  /// Agregado pela página: true se QUALQUER ativo resolvido deste plano
  /// estiver pendente.
  pendente: boolean;
}

// Forma mínima usada para popular o <select> de vínculo/responsável —
// compatível com listarAtivos()/listarTiposAtivo()/listarUsuarios(). `status`
// permite ao modal mostrar só opções Ativas no picker de vínculo (mesmo
// critério de ItemRevisionalOpcao abaixo), mantendo o vínculo atual do plano
// em edição visível mesmo se desativado depois.
export interface AtivoOpcao {
  id: string;
  nome: string;
  status: StatusAtivo;
}

export interface TipoAtivoOpcao {
  id: string;
  nome: string;
  status: StatusTipoAtivo;
}

export interface UsuarioOpcao {
  id: string;
  nome: string;
}

// Forma mínima usada pela aba "Itens revisionais" do modal — compatível com
// listarItensRevisionais(). `status` permite mostrar no picker só os itens
// Ativos (mais qualquer item já selecionado num plano em edição, mesmo que
// tenha sido arquivado depois).
export interface ItemRevisionalOpcao {
  id: string;
  nome: string;
  diasPadrao: number | null;
  kmPadrao: number | null;
  horasPadrao: number | null;
  status: StatusItemRevisional;
}
