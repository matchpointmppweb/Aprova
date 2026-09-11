import { Sidebar } from "@/src/components/shell/sidebar";
import { Topbar } from "@/src/components/shell/topbar";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";

// Casca autenticada (topbar/sidebar/breadcrumb) — toda rota fora de (auth)
// exige sessão autenticada e redireciona ao login sem sessão (Boundaries).
// O guard de sessão/status em si vive em exigirUsuarioAutenticado() — nunca
// reimplementado aqui.
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const usuario = await exigirUsuarioAutenticado();

  return (
    <>
      <Topbar nome={usuario.nome} papel={usuario.perfilAcesso.nome} />
      <Sidebar />
      <div className="main">{children}</div>
    </>
  );
}
