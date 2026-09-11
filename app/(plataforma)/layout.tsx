import { sairAction } from "@/src/server/actions/auth";
import { exigirOperadorDePlataforma } from "@/src/server/auth/sessao";

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).slice(0, 2);
  return partes.map((parte) => parte[0]?.toUpperCase() ?? "").join("") || "?";
}

// Shell segregada do operador de plataforma (Story 1.4, Approach) — fora da
// casca (dashboard) de conta-cliente, sem Sidebar de módulos de
// conta-cliente. Guarda exclusiva por exigirOperadorDePlataforma()
// (isPlataformaOperador === true, nunca can()/PerfilAcesso — AD-13):
// qualquer usuário que chegue até `children` já passou por esse gate.
//
// Topbar simples (nome do operador + sair) em vez da Topbar completa do
// dashboard (que tem busca/notificações específicas de conta-cliente,
// irrelevantes aqui).
export default async function PlataformaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const usuario = await exigirOperadorDePlataforma();

  return (
    <>
      <div className="topbar">
        <div className="brand-mark">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 2C8 6 5 9 5 13a7 7 0 0 0 14 0c0-4-3-7-7-11z" fill="currentColor" />
          </svg>
        </div>
        <div className="topbar-title">Raiz</div>

        <form action={sairAction} style={{ marginLeft: "auto" }}>
          <button type="submit" className="topbar-icon" title="Sair">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        </form>

        <div className="topbar-user">
          <div className="avatar">{iniciais(usuario.nome)}</div>
          <div>
            <div className="name">{usuario.nome}</div>
          </div>
        </div>
      </div>

      <div className="main-sem-sidebar">{children}</div>
    </>
  );
}
