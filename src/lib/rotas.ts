// Rotas citadas por mais de um módulo do servidor. Fica em src/lib (e não em
// src/server/actions/auth.ts) porque um módulo "use server" só pode exportar
// funções assíncronas — nenhuma constante.

/// Tela intermediária de escolha de ambiente (Story 6.4). Vive FORA de
/// app/(auth)/: aquele layout manda para "/" todo visitante com sessão, e aqui
/// a sessão existe de propósito — é justamente quem acabou de provar a senha e
/// ainda não tem conta ativa definida.
export const ROTA_ESCOLHER_AMBIENTE = "/escolher-ambiente";

/// Área segregada do operador de plataforma (app/(plataforma), AD-13). É para
/// onde vai, no login, a identidade `isPlataformaOperador` que não tem vínculo
/// com conta nenhuma — o painel de conta-cliente não teria o que lhe mostrar.
export const ROTA_CONTAS_PLATAFORMA = "/contas";
