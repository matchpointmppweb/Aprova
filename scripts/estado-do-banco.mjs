// Leitura SOMENTE de diagnóstico: contas, perfis e identidades do banco
// apontado por DATABASE_URL. Não escreve nada. Serve para conferir, antes de
// um teste manual, o que de fato existe.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import { config as carregarEnv } from "dotenv";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
carregarEnv({ path: path.join(raiz, ".env.local") });
carregarEnv({ path: path.join(raiz, ".env") });

const prisma = new PrismaClient();

const contas = await prisma.conta.findMany({
  include: { _count: { select: { vinculos: true, perfisAcesso: true } } },
  orderBy: { createdAt: "asc" },
});

console.log("\nCONTAS");
for (const conta of contas) {
  console.log(
    `  "${conta.nome}" | ${conta.status} | perfis=${conta._count.perfisAcesso} | vinculos=${conta._count.vinculos}`,
  );
}

const identidades = await prisma.usuario.findMany({
  include: {
    _count: { select: { vinculos: true, accounts: true } },
    vinculos: { include: { conta: { select: { nome: true } } } },
  },
  orderBy: { createdAt: "asc" },
});

console.log("\nIDENTIDADES");
for (const identidade of identidades) {
  const onde = identidade.vinculos
    .map((vinculo) => `${vinculo.conta.nome}(${vinculo.status})`)
    .join(", ");
  console.log(
    `  ${identidade.email} | operador=${identidade.isPlataformaOperador} | credenciais=${identidade._count.accounts} | vinculos: ${onde || "nenhum"}`,
  );
}

console.log("");
await prisma.$disconnect();
