import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Sidebar } from "@/src/components/shell/sidebar";
import { Topbar } from "@/src/components/shell/topbar";
import { auth } from "@/src/server/auth";
import type { UsuarioSessao } from "@/src/server/auth/tipos";
import { buscarUsuarioAutenticado } from "@/src/server/repositories/usuario";

// Casca autenticada (topbar/sidebar/breadcrumb) — toda rota fora de (auth)
// exige sessão autenticada e redireciona ao login sem sessão (Boundaries).
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const sessao = await auth.api.getSession({ headers: await headers() });

  if (!sessao) {
    redirect("/login");
  }

  const usuarioSessao = sessao.user as unknown as UsuarioSessao;
  const usuario = await buscarUsuarioAutenticado(
    usuarioSessao.id,
    usuarioSessao.contaId,
  );

  // Sessão válida, mas o usuário não existe mais na conta, foi desativado,
  // ou a conta ficou com pagamento pendente — revoga a sessão e trata como
  // não autenticado (o guard não pode confiar só na existência da sessão).
  if (!usuario || usuario.status !== "Ativo" || usuario.conta.status !== "Ativa") {
    await auth.api.signOut({ headers: await headers() }).catch(() => {});
    redirect("/login");
  }

  return (
    <>
      <Topbar nome={usuario.nome} papel={usuario.perfilAcesso.nome} />
      <Sidebar />
      <div className="main">{children}</div>
    </>
  );
}
