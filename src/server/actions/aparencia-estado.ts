// Tipo e estado inicial da Server Action de Aparência (paleta da Conta).
// Modo claro/escuro nunca passa por aqui (AD-11 — 100% client-side); só a
// paleta é mutação de dado de negócio (Conta.paletaDeCores), e por isso
// segue a mesma convenção { ok, error? } das demais Server Actions da
// spine (ex. usuario-estado.ts), sem erro por campo — um único valor é
// enviado (a chave da paleta clicada).
//
// Fica fora de actions/aparencia.ts porque um módulo "use server" só pode
// exportar funções assíncronas — nenhuma constante ou tipo.
export type EstadoAcaoAparencia = {
  ok: boolean;
  error?: string;
};

export const estadoInicialAcaoAparencia: EstadoAcaoAparencia = { ok: false };
