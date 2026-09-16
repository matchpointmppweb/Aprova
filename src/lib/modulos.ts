import type { Modulo } from "@prisma/client";

// "contas" é o único módulo do enum que NÃO é configurável por conta-cliente
// (AD-13): é permissão exclusiva da área segregada do operador de plataforma
// (Story 1.4), decidida por exigirOperadorDePlataforma() e jamais por can().
// Por isso não recebe rótulo na UI nem linha de PermissaoModulo nos perfis
// padrão — a exclusão é declarada UMA vez, aqui, no tipo.
export type ModuloConfiguravel = Exclude<Modulo, "contas">;

// Rótulos dos módulos configuráveis, indexados pelo próprio enum. É um
// `Record<ModuloConfiguravel, string>` de propósito: quando um módulo novo
// entrar no enum `Modulo` do schema, ESTE objeto para de compilar até ganhar um
// rótulo. É a garantia estrutural de que a lista da UI e a lista que decide as
// linhas de permissão (MODULOS_COM_PERMISSAO, src/server/perfis-padrao.ts,
// derivada do enum em tempo de execução) nunca divirjam — divergir significaria
// um módulo que ganha linha nos perfis provisionados e nenhum rótulo na tela,
// invisível e inconfigurável, que é exatamente o bug que a Story 6.7 fecha.
//
// A ORDEM das chaves é a ordem de exibição da matriz de permissões
// (Mockup.html:1601-1611) — `Object.keys` preserva ordem de inserção para
// chaves string.
export const ROTULOS_DE_MODULO: Record<ModuloConfiguravel, string> = {
  ativos: "Ativos",
  tipos: "Tipos",
  itens: "Itens revisionais",
  planos: "Planos revisionais",
  emissao: "Emissão",
  locais: "Locais",
  empresas: "Empresas",
  cargos: "Cargos",
  funcoes: "Funções",
  pessoas: "Pessoas",
  usuarios: "Usuários",
  perfil: "Perfil de acesso",
  aparencia: "Aparência",
};

// Módulos configuráveis na matriz de permissões da tela Perfil de acesso —
// fonte única para a UI (Story 1.3), agora DERIVADA do registro de rótulos em
// vez de escrita à mão ao lado dele.
export const MODULOS_PERFIL: { key: ModuloConfiguravel; label: string }[] = (
  Object.keys(ROTULOS_DE_MODULO) as ModuloConfiguravel[]
).map((key) => ({ key, label: ROTULOS_DE_MODULO[key] }));

// Nome do perfil semeado como Administrador (prisma/seed.ts) — protegido
// contra renomeação e, agora, contra perda da permissão de editar o módulo
// "perfil" (perfil-acesso.ts), para nunca travar o acesso a
// perfil/usuários fora da UI. Fonte única — server action, modal e a matriz de
// perfis padrão (src/server/perfis-padrao.ts) importam daqui em vez de
// redefinir a string.
export const NOME_ADMINISTRADOR = "Administrador";
