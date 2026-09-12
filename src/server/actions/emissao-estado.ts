// Tipo e estado inicial compartilhados pelas Server Actions de Emissão —
// mesma convenção { ok, data?, error? } de plano-estado.ts/
// item-revisional-estado.ts (Consistency Conventions da arquitetura).
//
// Fica fora de actions/emissao.ts porque um módulo "use server" só pode
// exportar funções assíncronas — nenhuma constante ou tipo (mesmo motivo de
// plano-estado.ts).
export type ErroDeValidacao = { field: string; message: string };

export type EstadoAcaoEmissao<T = undefined> = {
  ok: boolean;
  data?: T;
  error?: string | ErroDeValidacao[];
};

export const estadoInicialAcaoEmissao: EstadoAcaoEmissao = { ok: false };

// Mensagem exibida quando o `updatedAt` enviado pelo formulário não bate com
// o valor atual da emissão no banco (lock otimista, AD-9) — Boundaries/I-O
// Matrix: "Conflito de edição".
export const ERRO_CONFLITO_EDICAO =
  "Conflito de edição — os dados foram alterados por outra pessoa. Recarregue e tente de novo.";

// Achata o erro (string única ou array de erros por campo) numa mensagem
// exibível na UI, sem expor detalhe interno (Boundaries: erros nunca expõem
// detalhe de constraint/banco). Mesma função de plano-estado.ts.
export function mensagemDeErro(erro: EstadoAcaoEmissao["error"]): string | undefined {
  if (!erro) return undefined;
  if (typeof erro === "string") return erro;
  return erro.map((item) => item.message).join(" ");
}

export type ItemRevisionalReal = {
  id: string;
  nome: string;
  diasPadrao: number | null;
  kmPadrao: number | null;
  horasPadrao: number | null;
};

export type ItemDoPlanoVigente = {
  itemRevisionalId: string;
  diasOverride: number | null;
  kmOverride: number | null;
  horasOverride: number | null;
};

// Snapshot do valor esperado no momento em que o item entra na emissão
// (Boundaries): override do PlanoItemRevisional ?? padrão do ItemRevisional.
// Usado só na criação e na troca de plano da edição — uma edição posterior
// ao Plano/Item revisional de origem nunca reexecuta esta função para os
// itens já gravados (o repositório nunca toca valorEsperado* no fluxo
// update-in-place).
export function calcularValorEsperado(
  itemDoPlano: ItemDoPlanoVigente,
  itemReal: ItemRevisionalReal | undefined,
) {
  return {
    valorEsperadoDias: itemDoPlano.diasOverride ?? itemReal?.diasPadrao ?? null,
    valorEsperadoKm: itemDoPlano.kmOverride ?? itemReal?.kmPadrao ?? null,
    valorEsperadoHoras: itemDoPlano.horasOverride ?? itemReal?.horasPadrao ?? null,
  };
}

// Campos Gerais obrigatórios (I/O Matrix: "Criação feliz" exige
// ativo+plano+responsável+data válidos). Vínculo cross-tenant de cada id é
// checado à parte pela Server Action (contra os dados reais da conta),
// mesmo padrão de vinculoEResponsavelValidos em actions/plano.ts.
export function validarCamposGerais(campos: {
  ativoId: string;
  planoId: string;
  responsavelId: string;
  dataEmissao: Date | null;
}): ErroDeValidacao[] {
  const erros: ErroDeValidacao[] = [];
  if (!campos.ativoId) {
    erros.push({ field: "ativoId", message: "Selecione um ativo." });
  }
  if (!campos.planoId) {
    erros.push({ field: "planoId", message: "Selecione um plano revisional." });
  }
  if (!campos.responsavelId) {
    erros.push({ field: "responsavelId", message: "Selecione um responsável." });
  }
  if (!campos.dataEmissao || Number.isNaN(campos.dataEmissao.getTime())) {
    erros.push({ field: "dataEmissao", message: "Informe a data de emissão." });
  }
  return erros;
}
