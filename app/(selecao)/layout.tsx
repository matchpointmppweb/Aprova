import { BrandPanel } from "@/src/components/auth/brand-panel";

// Casca visual da escolha de ambiente (Story 6.4) — a MESMA de app/(auth)
// (#view-login + BrandPanel, AD-4), porque para quem está entrando a seleção é
// a continuação do login, não outra tela.
//
// Grupo de rota próprio, e não app/(auth)/, por um motivo concreto: aquele
// layout redireciona para "/" todo visitante COM sessão, e aqui a sessão
// existe de propósito — é justamente quem já provou a senha e ainda não tem
// conta ativa definida. Reaproveita-se o componente visual, não o guard.
//
// A guarda desta rota (sessão obrigatória, opções revalidadas contra o banco)
// vive na própria página, que já precisa ler as opções.
export default function SelecaoLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div id="view-login">
      <BrandPanel />
      <div className="login-form-wrap">{children}</div>
    </div>
  );
}
