// Tipo e estado inicial compartilhados pelas Server Actions de Itens
// revisionais — mesma convenção { ok, data?, error? } de ativo-estado.ts/
// tipo-ativo-estado.ts (Consistency Conventions da arquitetura).
//
// Fica fora de actions/item-revisional.ts porque um módulo "use server" só
// pode exportar funções assíncronas — nenhuma constante ou tipo.
export type ErroDeValidacao = { field: string; message: string };

export type EstadoAcaoItemRevisional<T = undefined> = {
  ok: boolean;
  data?: T;
  error?: string | ErroDeValidacao[];
};

export const estadoInicialAcaoItemRevisional: EstadoAcaoItemRevisional = { ok: false };

// Pelo menos um dos três controles precisa ser não-nulo e positivo ao salvar
// (Boundaries) — o banco não impõe "ao menos 1 de 3" sozinho, então esta
// validação roda sempre na Server Action, tanto em criar quanto em editar.
// Função pura, sem dependência de next/headers, extraída para este módulo
// (fora de "use server") para ficar testável isoladamente — mesmo motivo
// pelo qual os tipos/estado desta story já vivem aqui em vez de
// actions/item-revisional.ts.
export function validarControlesDeItemRevisional(campos: {
  diasPadrao: number | null;
  kmPadrao: number | null;
  horasPadrao: number | null;
}): ErroDeValidacao[] {
  const erros: ErroDeValidacao[] = [];

  // Todo controle não-nulo precisa ser positivo — checado independentemente
  // de "ao menos um selecionado" abaixo, para que ex. diasPadrao: 90,
  // kmPadrao: -5 seja rejeitado em vez de persistido (kmPadrao negativo não
  // pode virar badge "Km" em tabela-itens.tsx).
  if (campos.diasPadrao !== null && campos.diasPadrao <= 0) {
    erros.push({ field: "diasPadrao", message: "Dias deve ser maior que zero." });
  }
  if (campos.kmPadrao !== null && campos.kmPadrao <= 0) {
    erros.push({ field: "kmPadrao", message: "Km deve ser maior que zero." });
  }
  if (campos.horasPadrao !== null && campos.horasPadrao <= 0) {
    erros.push({ field: "horasPadrao", message: "Horas deve ser maior que zero." });
  }

  const algumSelecionado = [campos.diasPadrao, campos.kmPadrao, campos.horasPadrao].some(
    (valor) => valor !== null && valor > 0,
  );
  if (!algumSelecionado) {
    erros.push({ field: "controles", message: "Selecione ao menos um controle de medição." });
  }

  return erros;
}

// Achata o erro (string única ou array de erros por campo) numa mensagem
// exibível na UI, sem expor detalhe interno (Boundaries: erros nunca expõem
// detalhe de constraint/banco).
export function mensagemDeErro(erro: EstadoAcaoItemRevisional["error"]): string | undefined {
  if (!erro) return undefined;
  if (typeof erro === "string") return erro;
  return erro.map((item) => item.message).join(" ");
}
