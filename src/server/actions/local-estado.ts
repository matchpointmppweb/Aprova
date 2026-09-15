// Tipo e estado inicial compartilhados pelas Server Actions de Locais —
// mesma convenção { ok, data?, error? } de tipo-ativo-estado.ts (Consistency
// Conventions da arquitetura).
//
// Fica fora de actions/local.ts porque um módulo "use server" só pode
// exportar funções assíncronas — nenhuma constante ou tipo.
export type ErroDeValidacao = { field: string; message: string };

export type EstadoAcaoLocal<T = undefined> = {
  ok: boolean;
  data?: T;
  error?: string | ErroDeValidacao[];
};

export const estadoInicialAcaoLocal: EstadoAcaoLocal = { ok: false };

// Achata o erro (string única ou array de erros por campo) numa mensagem
// exibível na UI, sem expor detalhe interno (Boundaries: erros nunca expõem
// detalhe de constraint/banco).
export function mensagemDeErro(erro: EstadoAcaoLocal["error"]): string | undefined {
  if (!erro) return undefined;
  if (typeof erro === "string") return erro;
  return erro.map((item) => item.message).join(" ");
}
