// Tipo e estado inicial compartilhados pelas Server Actions de Usuários.
// Convenção de retorno da arquitetura (ARCHITECTURE-SPINE.md, Consistency
// Conventions): { ok, data?, error? } — error é string para erro geral
// (ex. sem permissão) ou um array { field, message } para erro de validação
// por campo (ex. e-mail já usado). Deliberadamente diferente de
// EstadoAcaoAuth (que é só { ok, error?, message? }) — esta é a convenção da
// spine, não a herdada da Story 1.1.
//
// Fica fora de actions/usuario.ts porque um módulo "use server" só pode
// exportar funções assíncronas — nenhuma constante ou tipo.
export type ErroDeValidacao = { field: string; message: string };

export type EstadoAcaoUsuario<T = undefined> = {
  ok: boolean;
  data?: T;
  error?: string | ErroDeValidacao[];
};

export const estadoInicialAcaoUsuario: EstadoAcaoUsuario = { ok: false };

// Achata o erro (string única ou array de erros por campo) numa mensagem
// exibível na UI, sem expor detalhe interno (Boundaries: "erros de
// convite/edição nunca expõem detalhe interno").
export function mensagemDeErro(erro: EstadoAcaoUsuario["error"]): string | undefined {
  if (!erro) return undefined;
  if (typeof erro === "string") return erro;
  return erro.map((item) => item.message).join(" ");
}
