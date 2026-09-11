// Fonte única do modo claro/escuro (CAP-11 / AD-11, Story 1.5), porta de
// Mockup.html:1431-1434 (NEUTRAL). Modo é preferência 100% client-side
// (localStorage) — nunca passa por Server Action nem por
// Conta.paletaDeCores (AD-11). Consumida pelo script inline anti-flash de
// app/layout.tsx e pelo toggle de
// src/components/aparencia/modo-toggle.tsx — nenhum dos dois deve
// redefinir estas cores.

export type ModoAparencia = "light" | "dark";

export type Neutros = {
  paper: string;
  paper2: string;
  white: string;
  ink: string;
  inkSoft: string;
  line: string;
  lineStrong: string;
};

export const NEUTRAL: Record<ModoAparencia, Neutros> = {
  light: {
    paper: "#F5F8F5",
    paper2: "#EEF3EE",
    white: "#FFFFFF",
    ink: "#152219",
    inkSoft: "#3F4F46",
    line: "#DEE7DE",
    lineStrong: "#C7D5C9",
  },
  dark: {
    paper: "#0F1613",
    paper2: "#161F1B",
    white: "#1B241F",
    ink: "#EAF3EC",
    inkSoft: "#9FB3A8",
    line: "#2A362F",
    lineStrong: "#3A483F",
  },
};

export const MODO_PADRAO: ModoAparencia = "light";

export const CHAVE_LOCALSTORAGE_MODO = "raiz:modo-aparencia";

export function ehModoValido(valor: string | null): valor is ModoAparencia {
  return valor === "light" || valor === "dark";
}

// Mapeamento var CSS -> chave de Neutros, compartilhado entre o script
// inline anti-flash (app/layout.tsx, serializado via JSON.stringify) e o
// toggle client (modo-toggle.tsx) — gera o mesmo conjunto de
// document.documentElement.style.setProperty(...) nos dois lugares sem
// repetir a lista de 7 nomes de variável.
export const VARS_NEUTROS: { cssVar: string; chave: keyof Neutros }[] = [
  { cssVar: "--paper", chave: "paper" },
  { cssVar: "--paper-2", chave: "paper2" },
  { cssVar: "--white", chave: "white" },
  { cssVar: "--ink", chave: "ink" },
  { cssVar: "--ink-soft", chave: "inkSoft" },
  { cssVar: "--line", chave: "line" },
  { cssVar: "--line-strong", chave: "lineStrong" },
];
