import type { Metadata } from "next";

import { RedefinirSenhaForm } from "@/src/components/auth/redefinir-senha-form";

export const metadata: Metadata = {
  title: "Redefinir senha — Raiz",
};

// O link enviado por e-mail aponta para /api/auth/reset-password/:token, que
// o Better Auth redireciona para cá com `?token=...` (link válido) ou
// `?error=INVALID_TOKEN` (link expirado/inválido) — ver
// src/server/actions/auth.ts (redirectTo: "/redefinir-senha").
export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;

  if (!params.token || params.error) {
    return (
      <div className="login-form">
        <h2>Redefinir senha</h2>
        <div className="form-error">
          Este link de redefinição de senha é inválido ou expirou. Solicite um
          novo link na tela de recuperação de senha.
        </div>
        <div className="login-foot">
          <a
            href="/esqueci-senha"
            style={{ color: "var(--pine-dark)", textDecoration: "none", fontWeight: 500 }}
          >
            Solicitar novo link
          </a>
        </div>
      </div>
    );
  }

  return <RedefinirSenhaForm token={params.token} />;
}
