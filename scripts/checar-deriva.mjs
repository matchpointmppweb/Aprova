// Falha quando `prisma/migrations` e `prisma/schema.prisma` divergem.
//
// Por que existe: as migrations deste projeto são escritas à mão e `npm run
// build` as aplica no banco de deploy (`prisma migrate deploy && next build`).
// Nada mais no pipeline compara as duas coisas — trocar `ON DELETE SET NULL`
// por `CASCADE` no SQL passaria por `prisma generate`, `tsc` e `next build` sem
// ruído nenhum, e apagar uma Conta levaria junto as sessões de todo mundo.
// `prisma migrate diff --exit-code` responde exatamente essa pergunta: aplicar
// as migrations, da primeira à última, produz o schema que o datamodel declara?
//
// Existe como arquivo, e não como uma linha em `scripts` do package.json,
// porque precisa de duas coisas que um script npm não faz de forma portátil:
// carregar o `.env.local` (o CLI do Prisma não o carrega sozinho quando há
// prisma.config.ts) e expandir a variável de ambiente do mesmo jeito no cmd.exe
// e no sh.
//
// Não é runner de teste nem pretende virar um: roda um comando e propaga o
// código de saída.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as carregarEnv } from "dotenv";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Mesma ordem de prisma.config.ts.
carregarEnv({ path: path.join(raiz, ".env.local") });
carregarEnv({ path: path.join(raiz, ".env") });

// `--from-migrations` REPLICA as migrations num banco descartável para chegar
// ao schema resultante — por isso o shadow é obrigatório, e por isso ele nunca
// pode ser o banco de desenvolvimento: o Prisma o reseta.
const shadow = process.env.SHADOW_DATABASE_URL;

if (!shadow) {
  console.error(
    "SHADOW_DATABASE_URL não definida.\n" +
      "A checagem replica as migrations num banco DESCARTÁVEL (o Prisma o reseta),\n" +
      "então aponte-a para um banco vazio e de uso exclusivo desta checagem —\n" +
      "NUNCA para DATABASE_URL. Ver .env.example.",
  );
  process.exit(1);
}

const resultado = spawnSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-migrations",
    "prisma/migrations",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--shadow-database-url",
    shadow,
    // Vazio: 0 | Erro: 1 | Diferente: 2.
    "--exit-code",
  ],
  { cwd: raiz, stdio: "inherit", shell: process.platform === "win32" },
);

if (resultado.status === 0) {
  console.log("Sem deriva: as migrations produzem exatamente o schema declarado.");
  process.exit(0);
}

if (resultado.status === 2) {
  console.error(
    "\nDERIVA: aplicar as migrations NÃO produz o schema.prisma declarado.\n" +
      "O diff acima é o que falta (ou sobra) nas migrations. Corrija o SQL\n" +
      "escrito à mão — nunca o schema — antes de fazer deploy.",
  );
  process.exit(2);
}

process.exit(resultado.status ?? 1);
