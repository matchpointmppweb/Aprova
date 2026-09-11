// Tipo e estado inicial compartilhados pelas Server Actions de Contas.
// Mesma convenção { ok, data?, error? } de usuario-estado.ts (Story 1.2) —
// error é string para erro geral ou um array { field, message } para erro de
// validação por campo (ex. CNPJ já usado).
//
// Fica fora de actions/conta.ts porque um módulo "use server" só pode
// exportar funções assíncronas — nenhuma constante ou tipo.
export type ErroDeValidacao = { field: string; message: string };

export type EstadoAcaoConta<T = undefined> = {
  ok: boolean;
  data?: T;
  error?: string | ErroDeValidacao[];
};

export const estadoInicialAcaoConta: EstadoAcaoConta = { ok: false };

// Achata o erro (string única ou array de erros por campo) numa mensagem
// exibível na UI, sem expor detalhe interno (nunca expõe detalhe de
// constraint — Boundaries).
export function mensagemDeErro(erro: EstadoAcaoConta["error"]): string | undefined {
  if (!erro) return undefined;
  if (typeof erro === "string") return erro;
  return erro.map((item) => item.message).join(" ");
}
