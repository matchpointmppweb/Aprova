// Tipo e estado inicial compartilhados pelas Server Actions de Planos
// revisionais — mesma convenção { ok, data?, error? } de
// item-revisional-estado.ts/ativo-estado.ts (Consistency Conventions da
// arquitetura).
//
// Fica fora de actions/plano.ts porque um módulo "use server" só pode
// exportar funções assíncronas — nenhuma constante ou tipo.
export type ErroDeValidacao = { field: string; message: string };

export type EstadoAcaoPlano<T = undefined> = {
  ok: boolean;
  data?: T;
  error?: string | ErroDeValidacao[];
};

export const estadoInicialAcaoPlano: EstadoAcaoPlano = { ok: false };

// Mensagem exibida quando o `updatedAt` enviado pelo formulário não bate com
// o valor atual do plano no banco (lock otimista, AD-9) — Boundaries/I-O
// Matrix: "Conflito de edição".
export const ERRO_CONFLITO_EDICAO =
  "Conflito de edição — os dados foram alterados por outra pessoa. Recarregue e tente de novo.";

// Achata o erro (string única ou array de erros por campo) numa mensagem
// exibível na UI, sem expor detalhe interno (Boundaries: erros nunca expõem
// detalhe de constraint/banco).
export function mensagemDeErro(erro: EstadoAcaoPlano["error"]): string | undefined {
  if (!erro) return undefined;
  if (typeof erro === "string") return erro;
  return erro.map((item) => item.message).join(" ");
}

// Vínculo é XOR: exatamente um entre ativoId/tipoAtivoId é não-nulo, nunca
// os dois, nunca nenhum (Boundaries) — o banco não impõe XOR entre 2 colunas
// sozinho, só a nulidade individual de cada FK. Função pura, testável
// isoladamente, sem dependência de next/headers — mesmo motivo pelo qual
// item-revisional-estado.ts extrai validarControlesDeItemRevisional daqui.
export function validarVinculoXor(
  ativoId: string | null,
  tipoAtivoId: string | null,
): ErroDeValidacao[] {
  const temAtivo = ativoId !== null;
  const temTipo = tipoAtivoId !== null;
  if (temAtivo === temTipo) {
    return [
      {
        field: "vinculo",
        message: "Selecione um ativo específico OU um tipo de ativo.",
      },
    ];
  }
  return [];
}

export type ItemSelecionadoBruto = {
  itemRevisionalId: string;
  diasOverride: number | null;
  kmOverride: number | null;
  horasOverride: number | null;
};

export type ItemRevisionalReal = {
  id: string;
  nome: string;
  diasPadrao: number | null;
  kmPadrao: number | null;
  horasPadrao: number | null;
};

// ≥1 item selecionado (Boundaries/I-O Matrix) e override só em controle que
// o próprio ItemRevisional já tem selecionado (não-nulo) — não dá pra
// inventar um controle novo que o item não define, validado aqui contra o
// item real (passado pela Server Action, que já o leu do repositório
// escopado por contaId).
export function validarItensDoPlano(
  itensSelecionados: ItemSelecionadoBruto[],
  itensReaisPorId: Map<string, ItemRevisionalReal>,
): ErroDeValidacao[] {
  const erros: ErroDeValidacao[] = [];

  if (itensSelecionados.length === 0) {
    erros.push({ field: "itens", message: "Selecione ao menos um item revisional." });
    return erros;
  }

  for (const item of itensSelecionados) {
    const itemReal = itensReaisPorId.get(item.itemRevisionalId);
    if (!itemReal) {
      erros.push({
        field: "itens",
        message: "Um dos itens selecionados é inválido.",
      });
      continue;
    }

    if (item.diasOverride !== null && itemReal.diasPadrao === null) {
      erros.push({
        field: "itens",
        message: `O item "${itemReal.nome}" não tem controle de dias para sobrescrever.`,
      });
    }
    if (item.kmOverride !== null && itemReal.kmPadrao === null) {
      erros.push({
        field: "itens",
        message: `O item "${itemReal.nome}" não tem controle de km para sobrescrever.`,
      });
    }
    if (item.horasOverride !== null && itemReal.horasPadrao === null) {
      erros.push({
        field: "itens",
        message: `O item "${itemReal.nome}" não tem controle de horas para sobrescrever.`,
      });
    }
  }

  return erros;
}
