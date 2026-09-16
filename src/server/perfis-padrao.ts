import { Modulo } from "@prisma/client";

// Import relativo: este módulo também é carregado pelo `tsx` do seed, fora do
// resolver de aliases do Next. `src/lib/modulos.ts` só importa `Modulo` como
// TIPO, então nada do Prisma entra no bundle do cliente por causa desta seta.
import { NOME_ADMINISTRADOR, type ModuloConfiguravel } from "../lib/modulos";

// Fonte ÚNICA da matriz de perfis de acesso padrão de uma conta-cliente
// (Story 6.7). Vivia só em `prisma/seed.ts`; agora é consumida pelos dois
// caminhos que provisionam uma conta — o seed e a criação de conta pelo
// operador de plataforma. Duplicá-la repetiria exatamente a causa do bug de
// permissões corrigido antes desta story, em que um módulo novo não ganhava
// linha nos perfis existentes.
//
// Este módulo importa `Modulo` como VALOR (não só como tipo) de propósito: a
// lista de módulos é derivada do enum em tempo de execução, e não escrita à
// mão. É isso que faz um módulo novo no `schema.prisma` já nascer com linha de
// permissão em todo perfil padrão, sem depender de ninguém lembrar de editar
// uma lista.
//
// Mora em `src/server/` exatamente por isso: trazer o enum como valor num
// arquivo de `src/lib/` deixaria um import acidental de Client Component puxar
// o objeto do Prisma para o bundle. A UI da tela Perfil de acesso continua
// usando `MODULOS_PERFIL` de `src/lib/modulos.ts`, que carrega os rótulos e é
// derivado do mesmo `ModuloConfiguravel` — o TypeScript cobra a exaustividade
// dos dois lados quando o enum cresce.
//
// Não leva `import "server-only"` (nem o singleton do Prisma): `prisma/seed.ts`
// roda fora do runtime do Next (tsx) e precisa importar exatamente esta matriz.

// "contas" é o único módulo do enum deliberadamente FORA da matriz (AD-13) — a
// exclusão é declarada no tipo `ModuloConfiguravel` (src/lib/modulos.ts), e
// esta é a contraparte em tempo de execução dela. Dar a "contas" uma linha de
// PermissaoModulo criaria um dado morto que, no perfil Administrador (acesso
// total), ainda pareceria conceder a uma conta-cliente poder sobre a plataforma
// inteira.
const MODULOS_NAO_CONFIGURAVEIS: Modulo[] = [Modulo.contas];

// Todos os módulos configuráveis do enum `Modulo`, derivados dele. Todo perfil
// padrão nasce com UMA linha por item desta lista — inclusive para os módulos
// sem nenhuma permissão marcada, que é o ponto. O tipo de retorno
// (`ModuloConfiguravel[]`) é o que amarra esta lista ao registro de rótulos da
// UI: as duas são exatamente o mesmo conjunto, cobrado pelo compilador.
export const MODULOS_COM_PERMISSAO: ModuloConfiguravel[] = Object.values(
  Modulo,
).filter(
  (modulo): modulo is ModuloConfiguravel =>
    !MODULOS_NAO_CONFIGURAVEIS.includes(modulo),
);

export const ACESSO_TOTAL = { criar: true, editar: true, excluir: true } as const;
export const SEM_ACESSO = { criar: false, editar: false, excluir: false } as const;

type PermissoesPorModulo = Partial<
  Record<Modulo, { criar: boolean; editar: boolean; excluir: boolean }>
>;

export type PerfilPadrao = {
  nome: string;
  descricao: string;
  permissoes: PermissoesPorModulo;
};

// Nome do perfil que recebe o primeiro Administrador da conta: a MESMA
// constante que as guardas contra renomear/rebaixar o perfil Administrador
// usam. Uma cópia local aqui viraria, se divergisse, uma exceção em toda conta
// nova (provisionarContaEm não acharia o perfil).
export { NOME_ADMINISTRADOR };

// Matriz extraída de perfis-de-acesso.md.
export const PERFIS_PADRAO: PerfilPadrao[] = [
  {
    nome: NOME_ADMINISTRADOR,
    descricao: "Acesso completo a todos os módulos.",
    permissoes: Object.fromEntries(
      MODULOS_COM_PERMISSAO.map((modulo) => [modulo, ACESSO_TOTAL]),
    ),
  },
  {
    nome: "Técnico de manutenção",
    descricao:
      "Cadastra/edita ativos, edita itens e planos revisionais, cria e edita emissões.",
    permissoes: {
      ativos: { criar: true, editar: true, excluir: false },
      itens: { criar: false, editar: true, excluir: false },
      planos: { criar: false, editar: true, excluir: false },
      emissao: { criar: true, editar: true, excluir: false },
    },
  },
  {
    nome: "Inspetor",
    descricao: "Apenas edita emissões (fluxo de análise/aprovação).",
    permissoes: {
      emissao: { criar: false, editar: true, excluir: false },
    },
  },
  {
    nome: "Somente leitura",
    descricao:
      "Visualização em todos os módulos, sem nenhuma permissão de escrita.",
    permissoes: Object.fromEntries(
      MODULOS_COM_PERMISSAO.map((modulo) => [modulo, SEM_ACESSO]),
    ),
  },
];

// As linhas de PermissaoModulo de um perfil padrão: sempre uma por módulo
// configurável, caindo em SEM_ACESSO onde a matriz não marca nada. Nunca só os
// módulos marcados — era assim que um módulo novo ficava sem linha.
export function permissoesDoPerfil(perfil: PerfilPadrao) {
  return MODULOS_COM_PERMISSAO.map((modulo) => ({
    modulo,
    ...(perfil.permissoes[modulo] ?? SEM_ACESSO),
  }));
}
