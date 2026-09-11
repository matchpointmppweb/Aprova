"use client";

import { useEffect, useLayoutEffect, useState } from "react";

import {
  CHAVE_LOCALSTORAGE_MODO,
  MODO_PADRAO,
  NEUTRAL,
  VARS_NEUTROS,
  ehModoValido,
  type ModoAparencia,
} from "@/src/lib/modo-aparencia";

// useLayoutEffect emite aviso no console quando o componente é
// server-rendered (React não roda efeitos no servidor) — troca para
// useEffect nesse caso; no cliente usa useLayoutEffect mesmo, pra reaplicar
// antes do paint (ver comentário no componente abaixo).
const useEfeitoDeLayoutIsomorfico = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function lerModoSalvo(): ModoAparencia {
  if (typeof window === "undefined") return MODO_PADRAO;
  try {
    const salvo = localStorage.getItem(CHAVE_LOCALSTORAGE_MODO);
    return ehModoValido(salvo) ? salvo : MODO_PADRAO;
  } catch {
    return MODO_PADRAO;
  }
}

function aplicarModo(modo: ModoAparencia) {
  const neutros = NEUTRAL[modo];
  const estilo = document.documentElement.style;
  VARS_NEUTROS.forEach(({ cssVar, chave }) => estilo.setProperty(cssVar, neutros[chave]));
}

// Toggle claro/escuro (Mockup.html:1198-1211) — 100% client-side (AD-11):
// nunca chama Server Action, nunca passa por can(). A preferência é por
// dispositivo (localStorage), não por conta/usuário, e por isso continua
// disponível mesmo para quem não tem permissão de editar a paleta da Conta
// (I/O Matrix: "usuário sem permissão... mas o toggle de modo claro/escuro
// continua disponível pra ele normalmente").
export function ModoToggle() {
  const [modo, setModo] = useState<ModoAparencia>(lerModoSalvo);

  // Reaplica as variáveis ao montar: cobre o remount de Strict Mode em dev
  // (que pode limpar o que o script inline de app/layout.tsx aplicou antes
  // do hydrate) e o caso de navegação client-side chegando nesta página
  // sem o script inline ter rodado de novo. No-op em produção quando o
  // script inline já deixou tudo consistente.
  useEfeitoDeLayoutIsomorfico(() => {
    aplicarModo(modo);
  }, [modo]);

  function alternar(novoModo: ModoAparencia) {
    setModo(novoModo);
    aplicarModo(novoModo);
    try {
      localStorage.setItem(CHAVE_LOCALSTORAGE_MODO, novoModo);
    } catch {
      // localStorage indisponível (ex. modo privado) — a troca ainda
      // funciona nesta sessão, só não persiste entre recarregamentos.
    }
  }

  return (
    <div className="mode-toggle">
      <button
        type="button"
        className={`mode-btn${modo === "light" ? " active" : ""}`}
        // O estado inicial (SSR sempre "light", window indisponível) pode
        // diferir do valor real salvo no dispositivo — igual ao <html> em
        // app/layout.tsx, isso é esperado e documentado no guia de
        // "preventing flash before hydration" do próprio Next.js.
        suppressHydrationWarning
        onClick={() => alternar("light")}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        Claro
      </button>
      <button
        type="button"
        className={`mode-btn${modo === "dark" ? " active" : ""}`}
        suppressHydrationWarning
        onClick={() => alternar("dark")}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
        </svg>
        Escuro
      </button>
    </div>
  );
}
