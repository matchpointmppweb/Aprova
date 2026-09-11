import "server-only";

/**
 * Envio do link de definição/redefinição de senha — modo desenvolvimento
 * (decisão confirmada no Intent da Story 1.1, reafirmada na Story 1.2): loga
 * o link no console/terminal em vez de enviar via Resend. A integração real
 * do Resend (RESEND_API_KEY) fica para uma história/tarefa futura.
 *
 * Usada tanto pelo fluxo de "esqueci minha senha" quanto pelo convite de
 * usuário (Story 1.2) — os dois reaproveitam o mesmo endpoint do Better Auth
 * (`auth.api.requestPasswordReset` / `sendResetPassword`), então a mensagem
 * é neutra em vez de assumir que é sempre um reset.
 */
export async function logarLinkDeDefinicaoDeSenha(email: string, url: string) {
  console.log(
    `[definir-senha] link de definição de senha para ${email}: ${url}`,
  );
}
