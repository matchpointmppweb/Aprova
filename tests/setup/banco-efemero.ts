import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// globalSetup do Vitest: sobe UM PostgreSQL real para a execução inteira,
// aplica as migrations versionadas do projeto nele, e o derruba ao fim.
//
// Por que as migrations e não `prisma db push`: metade do que este épico
// precisa verificar mora no SQL escrito à mão (backfills, pós-condições,
// `ON DELETE` das FKs). `db push` gera o schema a partir do datamodel e
// pularia exatamente essa parte — o teste passaria contra um banco que não é o
// que existe em produção.

// Porta ESCOLHIDA em runtime, não fixa. Com porta fixa, um cluster órfão de uma
// execução anterior (que o Windows demora a liberar) faz a execução seguinte
// morrer em "could not bind" — falha de infraestrutura que se parece com falha
// de teste. Pedir a porta ao sistema elimina a classe inteira.
async function portaLivre(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolver, rejeitar) => {
    const servidor = net.createServer();
    servidor.once("error", rejeitar);
    servidor.listen(0, "127.0.0.1", () => {
      const endereco = servidor.address();
      if (typeof endereco === "string" || endereco === null) {
        servidor.close();
        rejeitar(new Error("Não foi possível obter uma porta livre."));
        return;
      }
      const porta = endereco.port;
      servidor.close(() => resolver(porta));
    });
  });
}

const USUARIO = "postgres";
const SENHA = "postgres";
const BANCO = "raiz_teste";

let pg: EmbeddedPostgres | undefined;
let diretorio: string | undefined;

export async function setup() {
  // Diretório novo a cada execução: o Windows mantém arquivos do cluster
  // travados por alguns instantes depois do `stop`, então reaproveitar o mesmo
  // caminho faz a execução seguinte falhar em `initialise`.
  diretorio = fs.mkdtempSync(path.join(os.tmpdir(), "raiz-pg-"));
  const porta = await portaLivre();

  pg = new EmbeddedPostgres({
    databaseDir: diretorio,
    user: USUARIO,
    password: SENHA,
    port: porta,
    // A limpeza é nossa (ver `teardown`): com `persistent: false` a lib tenta
    // apagar o diretório durante o `stop` e morre com EBUSY no Windows.
    persistent: true,
    // Sem isso o initdb herda o locale da máquina (WIN1252 numa máquina
    // brasileira) e o banco de teste passa a divergir do Neon em acentuação e
    // ordenação — justamente onde o projeto ordena nomes de pessoas.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    // O initdb e o postgres escrevem dezenas de linhas em stdout/stderr. Elas
    // não dizem nada sobre os testes e afogam o resultado deles; o que importa
    // de verdade (falha ao subir) vem pela exceção de `initialise`/`start`.
    // `VERBOSE_PG=1` traz tudo de volta quando a infraestrutura é o suspeito.
    onLog: process.env.VERBOSE_PG ? console.log : () => {},
    onError: process.env.VERBOSE_PG ? console.error : () => {},
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase(BANCO);

  const url = `postgresql://${USUARIO}:${SENHA}@127.0.0.1:${porta}/${BANCO}`;

  // Sobrescreve para o processo de teste inteiro. A partir daqui, nenhum
  // caminho de código consegue alcançar o Neon, nem por engano.
  process.env.DATABASE_URL = url;
  process.env.TEST_DATABASE_URL = url;
  process.env.BETTER_AUTH_SECRET ??= "segredo-de-teste-nao-usar-em-producao";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

export async function teardown() {
  if (pg) {
    await pg.stop();
  }
  if (diretorio) {
    // O Postgres solta os arquivos de forma assíncrona no Windows; algumas
    // tentativas bastam. Falhar aqui não deve reprovar a execução — é lixo em
    // diretório temporário, não resultado de teste.
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      try {
        fs.rmSync(diretorio, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolver) => setTimeout(resolver, 300));
      }
    }
  }
}
