// Tipo e estado inicial compartilhados pelos formulários de autenticação.
// Fica fora de actions/auth.ts porque um módulo "use server" só pode
// exportar funções assíncronas — nenhuma constante ou tipo.
export type EstadoAcaoAuth = {
  ok: boolean;
  error?: string;
  message?: string;
};

export const estadoInicialAcaoAuth: EstadoAcaoAuth = { ok: false };
