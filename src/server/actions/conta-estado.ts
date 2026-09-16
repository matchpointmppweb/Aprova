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

// Story 6.7: a criação de conta leva dois dados a mais no `data`.
//   - `valores`: o que foi digitado, devolvido em TODO caminho de erro para o
//     formulário repor os campos (são seis, e React reseta um form não
//     controlado depois da action);
//   - `aviso`: recado de sucesso ao OPERADOR — hoje, que o administrador
//     informado já tinha acesso à plataforma e por isso não recebeu e-mail de
//     definição de senha.
export type ValoresNovaConta = {
  nome: string;
  cnpj: string;
  planoContratado: string;
  status: string;
  adminNome: string;
  adminEmail: string;
};

export type DadosCriacaoConta = {
  valores?: ValoresNovaConta;
  aviso?: string;
};

export type EstadoAcaoCriacaoConta = EstadoAcaoConta<DadosCriacaoConta>;

export const estadoInicialCriacaoConta: EstadoAcaoCriacaoConta = { ok: false };

// A mensagem do erro daquele campo específico, para renderizar junto do input.
export function erroDoCampo(
  erro: EstadoAcaoConta["error"],
  campo: string,
): string | undefined {
  if (!erro || typeof erro === "string") return undefined;
  return erro.find((item) => item.field === campo)?.message;
}

// Achata o erro (string única ou array de erros por campo) numa mensagem
// exibível na UI, sem expor detalhe interno (nunca expõe detalhe de
// constraint — Boundaries).
export function mensagemDeErro(erro: EstadoAcaoConta["error"]): string | undefined {
  if (!erro) return undefined;
  if (typeof erro === "string") return erro;
  return erro.map((item) => item.message).join(" ");
}
