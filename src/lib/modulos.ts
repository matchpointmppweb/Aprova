import type { Modulo } from "@prisma/client";

// Módulos configuráveis na matriz de permissões da tela Perfil de acesso —
// fonte única para a UI (Story 1.3). Mesma ordem de Mockup.html:1601-1611 /
// prisma/seed.ts:TODOS_OS_MODULOS. "contas" é deliberadamente omitido
// (AD-13, Boundaries desta story): é permissão exclusiva da área segregada
// do operador de plataforma (Story 1.4), nunca configurável por uma
// conta-cliente — mesmo motivo pelo qual não recebe linha de
// PermissaoModulo nos perfis do seed.
export const MODULOS_PERFIL: { key: Modulo; label: string }[] = [
  { key: "ativos", label: "Ativos" },
  { key: "tipos", label: "Tipos" },
  { key: "itens", label: "Itens revisionais" },
  { key: "planos", label: "Planos revisionais" },
  { key: "emissao", label: "Emissão" },
  { key: "locais", label: "Locais" },
  { key: "usuarios", label: "Usuários" },
  { key: "perfil", label: "Perfil de acesso" },
  { key: "aparencia", label: "Aparência" },
];

// Nome do perfil semeado como Administrador (prisma/seed.ts) — protegido
// contra renomeação e, agora, contra perda da permissão de editar o módulo
// "perfil" (perfil-acesso.ts), para nunca travar o acesso a
// perfil/usuários fora da UI. Fonte única — server action e modal
// importam daqui em vez de redefinir a string.
export const NOME_ADMINISTRADOR = "Administrador";
