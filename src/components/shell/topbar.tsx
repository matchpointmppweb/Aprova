import { sairAction } from "@/src/server/actions/auth";

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).slice(0, 2);
  return partes.map((parte) => parte[0]?.toUpperCase() ?? "").join("") || "?";
}

// Portado de Mockup.html (#view-app .topbar, AD-4). O ícone de sair
// (`title="Sair"`) não existe no mockup original (a demo estática não tinha
// logout funcional) — é a única adição necessária para uma casca de
// aplicação real.
export function Topbar({ nome, papel }: { nome: string; papel: string }) {
  return (
    <div className="topbar">
      <div className="brand-mark">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 2C8 6 5 9 5 13a7 7 0 0 0 14 0c0-4-3-7-7-11z" fill="currentColor" />
        </svg>
      </div>
      <div className="topbar-title">Raiz</div>
      <div className="topbar-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input placeholder="Buscar ativo, plano, emissão..." />
      </div>

      <button type="button" className="topbar-icon" title="Notificações">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        <span className="dot" />
      </button>

      <form action={sairAction}>
        <button type="submit" className="topbar-icon" title="Sair">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </button>
      </form>

      <div className="topbar-user">
        <div className="avatar">{iniciais(nome)}</div>
        <div>
          <div className="name">{nome}</div>
          <div className="role">{papel}</div>
        </div>
      </div>
    </div>
  );
}
