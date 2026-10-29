import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Infraestrutura de teste do projeto (Epic 7; segundo projeto em 29-10-2026).
//
// DOIS projetos, de propósito, com ambientes incompatíveis entre si:
//
// - `servidor`: tudo o que existia até aqui. Node puro, PostgreSQL de
//   verdade, serial. Lento e insubstituível.
// - `componente`: jsdom, sem banco, paralelo. Rápido e de escopo estreito.
//
// Fundi-los daria o pior dos dois: ou o teste de componente pagaria a subida
// do Postgres, ou o de banco rodaria num jsdom que não tem o que fazer ali.
//
// A divisão é pela EXTENSÃO do arquivo, não por pasta: `.test.ts` é servidor,
// `.componente.test.tsx` é tela. Sem interseção possível, e um arquivo novo
// cai no projeto certo pelo próprio nome.

const alias = {
  // `server-only` existe para QUEBRAR o build se um módulo de servidor for
  // importado por um componente cliente. Em teste não há fronteira
  // cliente/servidor, e o pacote lança ao ser importado fora do bundler do
  // Next — então aponta para um stub vazio. A garantia real continua onde
  // sempre esteve: no `npm run build`.
  "server-only": path.resolve(__dirname, "tests/setup/server-only-stub.ts"),
  "@": path.resolve(__dirname),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "servidor",
          // 1. BANCO REAL, NÃO MOCK. Todos os defeitos graves que as revisões
          //    do Epic 6 encontraram eram de banco — cláusula `where` frouxa,
          //    `updateMany` sem conferir `count`, migration de colapso
          //    destrutiva. Nenhum deles aparece com Prisma mockado, porque o
          //    mock devolve o que o teste mandar. O `globalSetup` sobe um
          //    PostgreSQL de verdade (embedded-postgres), em diretório
          //    temporário, derrubado ao fim.
          //
          // 2. NUNCA `DATABASE_URL`. Essa variável aponta para o Neon
          //    compartilhado com produção. O setup a SOBRESCREVE com a URL do
          //    banco efêmero antes de qualquer import de código de aplicação,
          //    e aborta se o banco efêmero não tiver subido — jamais "cai"
          //    para a URL real.
          globalSetup: ["./tests/setup/banco-efemero.ts"],
          setupFiles: ["./tests/setup/ambiente.ts"],
          // Um processo só: todos os testes compartilham o mesmo banco efêmero
          // e limpam as tabelas entre si. Paralelizar exigiria um banco por
          // worker, custo que não se paga na escala atual.
          fileParallelism: false,
          hookTimeout: 120_000,
          testTimeout: 30_000,
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "componente",
          environment: "jsdom",
          // `threads`, não o `forks` padrão: no pool de forks o jsdom 27 é
          // carregado por `require()` e estoura ERR_REQUIRE_ESM numa
          // dependência dele (@csstools/css-calc, que só publica ESM).
          pool: "threads",
          setupFiles: ["./tests/setup/dom.ts"],
          include: ["tests/**/*.componente.test.tsx"],
        },
      },
    ],
  },
});
