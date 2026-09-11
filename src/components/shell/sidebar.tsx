"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

function ChevIcon() {
  return (
    <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// Navegação portada de Mockup.html (#view-app .sidebar, AD-4). "Contas" foi
// deliberadamente omitido: é área segregada do operador de plataforma
// (AD-13), nunca visível para o Administrador de uma conta-cliente, e sua
// página é escopo da Story 1.4 — diferente do mockup, que mostrava todos os
// itens numa demo estática única.
export function Sidebar() {
  const pathname = usePathname();
  const [cadastrosAberto, setCadastrosAberto] = useState(true);
  const [configAberto, setConfigAberto] = useState(false);

  return (
    <div className="sidebar">
      <div className="side-group">
        <Link
          href="/"
          className={`side-item nav-item${pathname === "/" ? " active" : ""}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 11l9-8 9 8" />
            <path d="M5 10v10h14V10" />
          </svg>
          Início
        </Link>
      </div>

      <div className="side-group">
        <button
          type="button"
          className={`side-item group-toggle${cadastrosAberto ? " expanded" : ""}`}
          onClick={() => setCadastrosAberto((aberto) => !aberto)}
          aria-expanded={cadastrosAberto}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          Cadastros
          <ChevIcon />
        </button>
        <div className={`side-sub${cadastrosAberto ? "" : " hidden"}`}>
          <Link href="/ativos" className="side-item nav-item">Ativos</Link>
          <Link href="/tipos" className="side-item nav-item">Tipos</Link>
          <Link href="/itens-revisionais" className="side-item nav-item">Itens revisionais</Link>
          <Link href="/planos-revisionais" className="side-item nav-item">Planos revisionais</Link>
        </div>
      </div>

      <div className="side-group">
        <Link href="/emissao" className="side-item nav-item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13" />
            <path d="M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
          Emissão
        </Link>
      </div>

      <div className="side-group">
        <button
          type="button"
          className={`side-item group-toggle${configAberto ? " expanded" : ""}`}
          onClick={() => setConfigAberto((aberto) => !aberto)}
          aria-expanded={configAberto}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
          Configurações
          <ChevIcon />
        </button>
        <div className={`side-sub${configAberto ? "" : " hidden"}`}>
          <Link href="/usuarios" className="side-item nav-item">Usuários</Link>
          <Link href="/perfil-acesso" className="side-item nav-item">Perfil de acesso</Link>
          <Link href="/aparencia" className="side-item nav-item">Aparência</Link>
        </div>
      </div>
    </div>
  );
}
