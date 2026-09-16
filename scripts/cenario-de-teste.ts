/**
 * Popula o banco LOCAL de desenvolvimento com o cenário necessário para testar
 * o Epic 6 na tela — coisa que o seed normal não faz, porque ele cria a conta
 * raiz e mais nada.
 *
 * O que monta, e por quê cada peça existe:
 *
 *   - "Alfa Engenharia" e "Beta Manutenção": duas contas, para que exista
 *     isolamento a observar;
 *   - multi@teste.local: UMA identidade vinculada às DUAS contas, com perfis
 *     DIFERENTES (Administrador na Alfa, Técnico de manutenção na Beta). É o
 *     caso que faz aparecer a tela de escolha de ambiente e o seletor da
 *     topbar;
 *   - unica@teste.local: vinculada só à Alfa. É o contraste — tem de entrar
 *     direto, sem tela intermediária e sem seletor;
 *   - o administrador raiz do seed normal continua sendo quem acessa a área de
 *     plataforma (isPlataformaOperador).
 *
 * Todas as identidades usam a mesma senha, definida em CENARIO_SENHA
 * (padrão: "teste1234").
 *
 * NUNCA rode isto contra o banco de produção: ele aborta se a DATABASE_URL não
 * for local.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

import {
  OPCOES_DE_TRANSACAO_DE_PROVISIONAMENTO,
  provisionarContaEm,
} from "../src/server/repositories/provisionamento";

const prisma = new PrismaClient();

const SENHA = process.env.CENARIO_SENHA ?? "teste1234";

function exigirBancoLocal() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("@127.0.0.1:") && !url.includes("@localhost:")) {
    throw new Error(
      "[cenario] DATABASE_URL não é local. Este script escreve dados de teste " +
        "e nunca deve tocar o banco real. Use `npm run dev:local`.",
    );
  }
}

async function definirSenha(email: string) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { email } });
  const hash = await hashPassword(SENHA);

  await prisma.account.upsert({
    where: { providerId_accountId: { providerId: "credential", accountId: usuario.id } },
    create: {
      userId: usuario.id,
      providerId: "credential",
      accountId: usuario.id,
      password: hash,
    },
    update: { password: hash },
  });

  // Convite pendente vira acesso normal: quem testa não deveria ter de
  // percorrer o link de definição de senha para cada identidade.
  await prisma.vinculoConta.updateMany({
    where: { usuarioId: usuario.id },
    data: { status: "Ativo" },
  });
}

async function provisionar(nome: string, cnpj: string, admin: { nome: string; email: string }) {
  const existente = await prisma.conta.findUnique({ where: { cnpj } });
  if (existente) {
    console.log(`[cenario] Conta "${nome}" já existe — reaproveitando.`);
    return existente;
  }

  const resultado = await prisma.$transaction(
    (tx) =>
      provisionarContaEm(tx, {
        conta: { nome, cnpj, planoContratado: "Essencial", status: "Ativa" },
        administrador: admin,
      }),
    OPCOES_DE_TRANSACAO_DE_PROVISIONAMENTO,
  );

  console.log(`[cenario] Conta "${nome}" provisionada com ${resultado.perfis.length} perfis.`);
  return prisma.conta.findUniqueOrThrow({ where: { id: resultado.conta.id } });
}

async function main() {
  exigirBancoLocal();

  // A identidade multiconta nasce como administradora da Alfa...
  const alfa = await provisionar("Alfa Engenharia", "11.111.111/0001-11", {
    nome: "Multi (Administrador na Alfa)",
    email: "multi@teste.local",
  });

  // ...e a Beta nasce com outro administrador, para que a Alfa não seja dona
  // de tudo.
  const beta = await provisionar("Beta Manutenção", "22.222.222/0001-22", {
    nome: "Admin da Beta",
    email: "admin.beta@teste.local",
  });

  // O vínculo que cria o cenário multiconta: a MESMA identidade na Beta, com
  // perfil DIFERENTE e nome DIFERENTE — é assim que dá para ver, na tela, que
  // cada conta enxerga a pessoa do seu próprio jeito.
  const multi = await prisma.usuario.findUniqueOrThrow({
    where: { email: "multi@teste.local" },
  });
  const tecnicoDaBeta = await prisma.perfilAcesso.findFirstOrThrow({
    where: { contaId: beta.id, nome: "Técnico de manutenção" },
  });

  await prisma.vinculoConta.upsert({
    where: { usuarioId_contaId: { usuarioId: multi.id, contaId: beta.id } },
    create: {
      usuarioId: multi.id,
      contaId: beta.id,
      perfilAcessoId: tecnicoDaBeta.id,
      nome: "Multi (Técnico na Beta)",
      status: "Ativo",
    },
    update: { perfilAcessoId: tecnicoDaBeta.id, status: "Ativo" },
  });

  // A identidade de contraste: uma conta só.
  const administradorDaAlfa = await prisma.perfilAcesso.findFirstOrThrow({
    where: { contaId: alfa.id, nome: "Administrador" },
  });
  const unica = await prisma.usuario.upsert({
    where: { email: "unica@teste.local" },
    create: { nome: "Única (só na Alfa)", email: "unica@teste.local", status: "Ativo" },
    update: {},
  });
  await prisma.vinculoConta.upsert({
    where: { usuarioId_contaId: { usuarioId: unica.id, contaId: alfa.id } },
    create: {
      usuarioId: unica.id,
      contaId: alfa.id,
      perfilAcessoId: administradorDaAlfa.id,
      nome: "Única na Alfa",
      status: "Ativo",
    },
    update: { status: "Ativo" },
  });

  for (const email of ["multi@teste.local", "admin.beta@teste.local", "unica@teste.local"]) {
    await definirSenha(email);
  }

  console.log(`
[cenario] Pronto. Entre em http://localhost:3000/login com:

  multi@teste.local   -> DUAS contas  (deve PARAR na tela de escolha)
  unica@teste.local   -> UMA conta    (deve ENTRAR direto)

  Senha para as duas: ${SENHA}
`);
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
