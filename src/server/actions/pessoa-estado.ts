// Tipo e estado inicial compartilhados pelas Server Actions de Pessoas —
// mesma convenção { ok, data?, error? } de empresa-estado.ts (Consistency
// Conventions da arquitetura).
//
// Fica fora de actions/pessoa.ts porque um módulo "use server" só pode
// exportar funções assíncronas — nenhuma constante ou tipo.
export type ErroDeValidacao = { field: string; message: string };

export type EstadoAcaoPessoa<T = undefined> = {
  ok: boolean;
  data?: T;
  error?: string | ErroDeValidacao[];
};

export const estadoInicialAcaoPessoa: EstadoAcaoPessoa = { ok: false };

// Achata o erro (string única ou array de erros por campo) numa mensagem
// exibível na UI, sem expor detalhe interno (Boundaries: erros nunca expõem
// detalhe de constraint/banco, nem a existência de um Cargo/Função/Pessoa de
// outra conta).
export function mensagemDeErro(erro: EstadoAcaoPessoa["error"]): string | undefined {
  if (!erro) return undefined;
  if (typeof erro === "string") return erro;
  return erro.map((item) => item.message).join(" ");
}
