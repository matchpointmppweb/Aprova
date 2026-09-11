// Fonte única das 5 paletas de cores da Conta (CAP-11 / AD-11, Story 1.5),
// portadas de Mockup.html:1423-1429 (PALETTES) e :1449-1461
// (applyPalette/darkenHex). Consumida pelo <style> server-side de
// app/(dashboard)/layout.tsx e pela grade de cartões de
// src/components/aparencia/paleta-grid.tsx — nenhum dos dois deve
// redefinir estas cores.

export type PaletaChave =
  | "verde-floresta"
  | "verde-cedro"
  | "verde-noturno"
  | "laguna-profunda"
  | "retro-piscina";

export type Paleta = {
  nome: string;
  forest: string;
  forest2: string;
  pine: string;
  pineDark: string;
  sage: string;
  sagePale: string;
};

// Mesma fórmula de Mockup.html:1443-1447 (darkenHex) — usada só para as
// paletas cujo pineDark não veio pronto do mockup (cedro/noturno/laguna,
// PALETTES:1425-1427 tinham pineDark:null e resolviam via
// darkenHex(pine,0.18) dentro de applyPalette).
function escurecer(hex: string, quantidade: number): string {
  const valor = hex.replace("#", "");
  const r = parseInt(valor.substring(0, 2), 16);
  const g = parseInt(valor.substring(2, 4), 16);
  const b = parseInt(valor.substring(4, 6), 16);
  const canal = (c: number) => Math.round(c * (1 - quantidade)).toString(16).padStart(2, "0");
  return `#${canal(r)}${canal(g)}${canal(b)}`;
}

type PaletaBruta = Omit<Paleta, "pineDark"> & { pineDark: string | null };

const PALETAS_BRUTAS: Record<PaletaChave, PaletaBruta> = {
  "verde-floresta": {
    nome: "Verde Floresta",
    forest: "#173A2C",
    forest2: "#1F4D3A",
    pine: "#2C6E4F",
    pineDark: "#215839",
    sage: "#8FCBA6",
    sagePale: "#DCEEE1",
  },
  "verde-cedro": {
    nome: "Verde Cedro",
    forest: "#071821",
    forest2: "#145A4C",
    pine: "#1E9B83",
    pineDark: null,
    sage: "#A9E5D1",
    sagePale: "#F1EEE7",
  },
  "verde-noturno": {
    nome: "Verde Noturno",
    forest: "#0B1F33",
    forest2: "#0F4E3A",
    pine: "#1F8E7A",
    pineDark: null,
    sage: "#A7DDC9",
    sagePale: "#F2FBF7",
  },
  "laguna-profunda": {
    nome: "Laguna Profunda",
    forest: "#0A0F14",
    forest2: "#003B46",
    pine: "#07575B",
    pineDark: null,
    sage: "#66A5AD",
    sagePale: "#DCEEF1",
  },
  "retro-piscina": {
    nome: "Retrô à Beira da Piscina",
    forest: "#023047",
    forest2: "#0077B6",
    pine: "#00B4D8",
    pineDark: "#2A9D8F",
    sage: "#90E0EF",
    sagePale: "#E4F8FC",
  },
};

export const PALETAS: Record<PaletaChave, Paleta> = Object.fromEntries(
  (Object.entries(PALETAS_BRUTAS) as [PaletaChave, PaletaBruta][]).map(([chave, paleta]) => [
    chave,
    { ...paleta, pineDark: paleta.pineDark ?? escurecer(paleta.pine, 0.18) },
  ]),
) as Record<PaletaChave, Paleta>;

// Mesma string do @default de Conta.paletaDeCores (prisma/schema.prisma,
// Story 1.1) — mudar este valor exige migration.
export const PALETA_PADRAO: PaletaChave = "verde-floresta";

// Valida uma chave contra as 5 conhecidas — nunca deixa passar um valor
// arbitrário (Boundaries/I-O Matrix: "Paleta inválida enviada ao
// servidor").
export function ehPaletaValida(valor: string): valor is PaletaChave {
  return Object.prototype.hasOwnProperty.call(PALETAS, valor);
}

// Resolve a chave salva em Conta.paletaDeCores (campo String livre no
// schema, não um enum) contra as chaves conhecidas — cai para
// PALETA_PADRAO se não bater com nenhuma (ex. dado legado/corrompido).
// Única fonte dessa regra de fallback — resolverPaleta() e qualquer outro
// consumidor que só precise da chave (não do objeto Paleta inteiro, ex.
// app/(dashboard)/aparencia/page.tsx) devem chamar esta função em vez de
// reimplementar o ternário.
export function resolverChavePaleta(chave: string | null | undefined): PaletaChave {
  if (chave && ehPaletaValida(chave)) {
    return chave;
  }
  return PALETA_PADRAO;
}

// Para nunca quebrar o layout (Code Map: app/(dashboard)/layout.tsx).
export function resolverPaleta(chave: string | null | undefined): Paleta {
  return PALETAS[resolverChavePaleta(chave)];
}
