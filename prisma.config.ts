import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// O CLI do Prisma não carrega .env automaticamente quando há prisma.config.ts
// (só o runtime do Next.js faz isso para a aplicação). Carregamos aqui para
// que `prisma migrate`/`prisma db seed` enxerguem DATABASE_URL.
loadEnv({ path: path.join(__dirname, ".env.local") });
loadEnv({ path: path.join(__dirname, ".env") });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
