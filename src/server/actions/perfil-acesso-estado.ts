// Tipo e estado inicial compartilhados pelas Server Actions de Perfil de
// acesso — mesma convenção { ok, data?, error? } de usuario-estado.ts
// (Consistency Conventions da arquitetura).
//
// Fica fora de actions/perfil-acesso.ts porque um módulo "use server" só
// pode exportar funções assíncronas — nenhuma constante ou tipo.
export type ErroDeValidacao = { field: string; message: string };

export type EstadoAcaoPerfil<T = undefined> = {
  ok: boolean;
  data?: T;
  error?: string | ErroDeValidacao[];
};

export const estadoInicialAcaoPerfil: EstadoAcaoPerfil = { ok: false };

// Achata o erro (string única ou array de erros por campo) numa mensagem
// exibível na UI, sem expor detalhe interno (Boundaries: erros nunca expõem
// detalhe de constraint/banco).
export function mensagemDeErro(erro: EstadoAcaoPerfil["error"]): string | undefined {
  if (!erro) return undefined;
  if (typeof erro === "string") return erro;
  return erro.map((item) => item.message).join(" ");
}
