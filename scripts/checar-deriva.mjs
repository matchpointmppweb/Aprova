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
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as carregarEnv } from "dotenv";
import EmbeddedPostgres from "embedded-postgres";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Mesma ordem de prisma.config.ts.
carregarEnv({ path: path.join(raiz, ".env.local") });
carregarEnv({ path: path.join(raiz, ".env") });

// `--from-migrations` REPLICA as migrations num banco descartável para chegar
// ao schema resultante — por isso o shadow é obrigatório, e por isso ele nunca
// pode ser o banco de desenvolvimento: o Prisma o reseta.
// Quando não há `SHADOW_DATABASE_URL` configurada, o shadow é SUBIDO AQUI: o
// mesmo PostgreSQL embarcado que os testes usam, num diretório temporário,
// derrubado ao fim. Antes esta checagem apenas AVISAVA e seguia, e o efeito
// prático era a deriva nunca ser conferida na máquina de ninguém — o único
// lugar onde um `ON DELETE` trocado à mão apareceria antes do deploy.
//
// A variável continua sendo respeitada quando existe: quem já tem um banco
// descartável (um branch do Neon, por exemplo) não paga o custo de subir um.
let shadow = process.env.SHADOW_DATABASE_URL;
let embarcado;
let diretorioEmbarcado;

async function portaLivre() {
  return new Promise((resolver, rejeitar) => {
    const servidor = net.createServer();
    servidor.once("error", rejeitar);
    servidor.listen(0, "127.0.0.1", () => {
      const { port } = servidor.address();
      servidor.close(() => resolver(port));
    });
  });
}

async function subirShadowEmbarcado() {
  diretorioEmbarcado = fs.mkdtempSync(path.join(os.tmpdir(), "raiz-shadow-"));
  const porta = await portaLivre();

  embarcado = new EmbeddedPostgres({
    databaseDir: diretorioEmbarcado,
    user: "postgres",
    password: "postgres",
    port: porta,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });

  await embarcado.initialise();
  await embarcado.start();
  await embarcado.createDatabase("raiz_shadow");

  return `postgresql://postgres:postgres@127.0.0.1:${porta}/raiz_shadow`;
}

async function derrubarShadowEmbarcado() {
  if (embarcado) {
    try {
      await embarcado.stop();
    } catch {
      // Derrubar o shadow não pode alterar o veredito da checagem.
    }
  }
  if (diretorioEmbarcado) {
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      try {
        fs.rmSync(diretorioEmbarcado, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolver) => setTimeout(resolver, 300));
      }
    }
  }
}

if (!shadow) {
  console.log("SHADOW_DATABASE_URL ausente — subindo PostgreSQL efêmero local.");
  shadow = await subirShadowEmbarcado();
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

await derrubarShadowEmbarcado();

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
