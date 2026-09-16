/**
 * `next dev` contra um PostgreSQL LOCAL, não contra o Neon.
 *
 * Por que existe: a `DATABASE_URL` do `.env.local` aponta para o mesmo banco
 * que produção usa. Testar telas à mão exige criar contas, convidar pessoas e
 * trocar de ambiente — ou seja, escrever. Fazer isso no banco de produção é
 * risco desnecessário, ainda mais para verificar layout.
 *
 * O que faz: sobe o mesmo PostgreSQL embarcado dos testes (mas PERSISTENTE, em
 * `.dev-db/`, para os dados sobreviverem entre execuções), aplica as
 * migrations, semeia o cenário de teste na primeira vez, e então roda
 * `next dev` com a DATABASE_URL apontando para ele. Ao encerrar (Ctrl+C), o
 * banco é derrubado e os dados ficam onde estão, prontos para a próxima.
 *
 * Para começar do zero: apague a pasta `.dev-db/`.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import EmbeddedPostgres from "embedded-postgres";
// `pg` já vem como dependência do embedded-postgres; usado só para a consulta
// de "o banco está vazio?".
import pgLib from "pg";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const diretorio = path.join(raiz, ".dev-db");
const BANCO = "raiz_dev";

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

const primeiraVez = !fs.existsSync(diretorio);
const porta = await portaLivre();

const pg = new EmbeddedPostgres({
  databaseDir: diretorio,
  user: "postgres",
  password: "postgres",
  port: porta,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});

if (primeiraVez) {
  console.log("Primeira execução: criando o banco local em .dev-db/ ...");
  await pg.initialise();
}
await pg.start();

try {
  await pg.createDatabase(BANCO);
} catch (erro) {
  // Já existe: é o caso normal a partir da segunda execução, e também o de uma
  // primeira execução interrompida depois do `initialise`.
  if (!String(erro?.message ?? erro).includes("already exists")) {
    throw erro;
  }
}

const url = `postgresql://postgres:postgres@127.0.0.1:${porta}/${BANCO}`;
// `DATABASE_URL` sobrescrita para TODO processo filho. O `.env.local` ainda é
// lido pelo Next (é de lá que vem BETTER_AUTH_SECRET), mas o valor daqui vence
// porque o ambiente do processo tem precedência sobre o arquivo.
// A senha do seed é obrigatória e sem padrão — com razão, porque o seed normal
// também roda contra o banco real. Aqui o banco é local e descartável, então um
// padrão conhecido é o certo: exigir configuração para inspecionar uma tela
// seria atrito sem ganho de segurança.
const ambiente = {
  ...process.env,
  DATABASE_URL: url,
  SEED_ADMIN_SENHA: process.env.SEED_ADMIN_SENHA ?? "teste1234",
};

function rodar(comando, args, rotulo) {
  const resultado = spawnSync(comando, args, {
    cwd: raiz,
    env: ambiente,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (resultado.status !== 0) {
    throw new Error(`Falha em ${rotulo} (código ${resultado.status}).`);
  }
}

let servidor;

async function encerrar(codigo) {
  if (servidor && !servidor.killed) {
    servidor.kill();
  }
  try {
    await pg.stop();
  } catch {
    // Nada a fazer: o processo está saindo de qualquer forma.
  }
  process.exit(codigo);
}

try {
  console.log("Aplicando migrations no banco local ...");
  rodar("npx", ["prisma", "migrate", "deploy"], "prisma migrate deploy");

  // A decisão de semear olha os DADOS, não a existência da pasta: uma primeira
  // execução interrompida entre o `initialise` e o seed deixaria a pasta no
  // lugar e o banco vazio — e, com a pasta como critério, vazio para sempre.
  // Os dois scripts abaixo são idempotentes, então repetir é inofensivo.
  const cliente = new pgLib.Client({ connectionString: url });
  await cliente.connect();
  const { rows } = await cliente.query('SELECT COUNT(*)::int AS total FROM "contas"');
  await cliente.end();

  if (rows[0].total === 0) {
    console.log("Banco vazio: semeando a conta raiz ...");
    rodar("npx", ["tsx", "prisma/seed.ts"], "seed");
    console.log("Semeando o cenário de teste multiconta ...");
    rodar("npx", ["tsx", "scripts/cenario-de-teste.ts"], "cenário de teste");
  }

  console.log(`\nBanco LOCAL em uso (produção intocada). Subindo o Next ...\n`);

  servidor = spawn("npx", ["next", "dev"], {
    cwd: raiz,
    env: ambiente,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  servidor.on("exit", (codigo) => encerrar(codigo ?? 0));
  process.on("SIGINT", () => encerrar(0));
  process.on("SIGTERM", () => encerrar(0));
} catch (erro) {
  console.error(erro);
  await encerrar(1);
}
