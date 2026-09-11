import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { BrandPanel } from "@/src/components/auth/brand-panel";
import { auth } from "@/src/server/auth";

// Casca visual das telas de login/recuperação de senha, portada de
// Mockup.html (#view-login, AD-4). Cada página injeta apenas o conteúdo de
// `.login-form-wrap`. Quem já tem sessão válida não deve ver estas telas.
export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const sessao = await auth.api.getSession({ headers: await headers() });

  if (sessao) {
    redirect("/");
  }

  return (
    <div id="view-login">
      <BrandPanel />
      <div className="login-form-wrap">{children}</div>
    </div>
  );
}
