import { defineConfig } from "vitest/config";
import path from "node:path";

// Infraestrutura de teste do projeto (Epic 7).
//
// Duas decisões que valem registro:
//
// 1. BANCO REAL, NÃO MOCK. Todos os defeitos graves que as revisões do Epic 6
//    encontraram eram de banco — cláusula `where` frouxa, `updateMany` sem
//    conferir `count`, migration de colapso destrutiva. Nenhum deles aparece
//    com Prisma mockado, porque o mock devolve o que o teste mandar. O
//    `globalSetup` sobe um PostgreSQL de verdade (embedded-postgres), em
//    diretório temporário, derrubado ao fim.
//
// 2. NUNCA `DATABASE_URL`. Essa variável aponta para o Neon compartilhado com
//    produção. O setup a SOBRESCREVE com a URL do banco efêmero antes de
//    qualquer import de código de aplicação, e aborta se o banco efêmero não
//    tiver subido — jamais "cai" para a URL real.
export default defineConfig({
  test: {
    globalSetup: ["./tests/setup/banco-efemero.ts"],
    setupFiles: ["./tests/setup/ambiente.ts"],
    // Um processo só: todos os testes compartilham o mesmo banco efêmero e
    // limpam as tabelas entre si. Paralelizar exigiria um banco por worker,
    // custo que não se paga na escala atual.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // `server-only` existe para QUEBRAR o build se um módulo de servidor for
      // importado por um componente cliente. Em teste não há fronteira
      // cliente/servidor, e o pacote lança ao ser importado fora do bundler do
      // Next — então aponta para um stub vazio. A garantia real continua onde
      // sempre esteve: no `npm run build`.
      "server-only": path.resolve(__dirname, "tests/setup/server-only-stub.ts"),
      "@": path.resolve(__dirname),
    },
  },
});
