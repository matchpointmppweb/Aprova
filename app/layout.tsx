import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Space_Grotesk } from "next/font/google";

import "@/src/styles/globals.css";
import { CHAVE_LOCALSTORAGE_MODO, NEUTRAL, VARS_NEUTROS } from "@/src/lib/modo-aparencia";

// Mesma família tipográfica do mockup (AD-4: Space Grotesk para títulos, IBM
// Plex Sans para corpo, IBM Plex Mono para código/valores) — carregada via
// next/font em vez de <link> para Google Fonts (auto-hospedada, sem
// requisição externa, sem layout shift).
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Raiz — Gestão de Ativos",
  description: "Controle de ativos, planos revisionais e emissões em um só lugar.",
};

// Script anti-flash de modo claro/escuro (AD-11, Story 1.5): lê o modo
// salvo em localStorage e, se for "dark", aplica as variáveis CSS de
// NEUTRAL.dark antes do 1º paint — evita o flash de modo claro ao
// recarregar a página em modo escuro (I/O Matrix). Roda em toda rota,
// inclusive (auth) (modo é preferência de dispositivo, sem depender de
// sessão — AD-11). Os valores são serializados a partir de
// src/lib/modo-aparencia.ts (fonte única, Code Map) em vez de duplicar
// nomes/cores de variável aqui — mesma técnica do guia "preventing flash
// before hydration" dos docs do Next.js (node_modules/next/dist/docs).
const scriptAntiFlashModo = `(function(){try{var m=localStorage.getItem(${JSON.stringify(
  CHAVE_LOCALSTORAGE_MODO,
)});if(m!=="dark")return;var n=${JSON.stringify(NEUTRAL.dark)};var vars=${JSON.stringify(
  VARS_NEUTROS,
)};var s=document.documentElement.style;for(var i=0;i<vars.length;i++){s.setProperty(vars[i].cssVar,n[vars[i].chave])}}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="pt-BR"
      className={`${spaceGrotesk.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}
      // O script abaixo muda o `style` de <html> antes do hydrate —
      // suppressHydrationWarning evita o warning de mismatch nesse atributo
      // (mesmo padrão do guia "preventing flash before hydration").
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: scriptAntiFlashModo }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
