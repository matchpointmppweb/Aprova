import "server-only";

import { PrismaClient } from "@prisma/client";

// Única via de instanciação do Prisma Client (AD-1). Todo módulo de domínio
// (repositories/*) importa este singleton; a única exceção é
// `src/server/auth/index.ts`, que precisa passar uma instância crua ao
// adapter do Better Auth — a própria lib de autenticação é quem executa as
// queries nas tabelas de sessão/credencial a partir daí, não código de
// domínio nosso.
//
// Padrão recomendado pelo Next.js para não recriar o client a cada
// hot-reload em desenvolvimento.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
