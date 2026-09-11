import "server-only";

/**
 * Envio de e-mail de reset de senha — modo desenvolvimento (decisão
 * confirmada no Intent desta story): loga o link no console/terminal em vez
 * de enviar via Resend. A integração real do Resend (RESEND_API_KEY) fica
 * para uma história/tarefa futura.
 */
export async function logarLinkDeResetDeSenha(email: string, url: string) {
  console.log(
    `[reset-senha] link de redefinição para ${email}: ${url}`,
  );
}
