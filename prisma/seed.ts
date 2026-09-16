/**
 * Bootstrap da primeira Conta, do primeiro Administrador e dos 4 perfis de
 * acesso padrão (Deferred da arquitetura — "Bootstrap da primeira Conta +
 * Administrador"). Não há auto-cadastro público: este script é a única via
 * de criação da Conta inicial.
 *
 * Story 6.7: o seed deixou de ter provisionamento próprio. A conta, os perfis
 * padrão e o vínculo do primeiro Administrador vêm de `provisionarContaEm` —
 * a MESMA função que a criação de conta pelo operador de plataforma usa. Dois
 * ganhos num movimento só: a matriz de perfis padrão existe num lugar só
 * (src/lib/perfis-padrao.ts), e o seed passou a ser transacional — antes conta,
 * perfis, usuário e credencial eram escritas independentes, e uma falha no meio
 * deixava o banco parcialmente semeado, sem reparo.
 *
 * O que continua exclusivo do seed é o que ele precisa e o produto não faz:
 * gravar a SENHA do administrador raiz e marcar `isPlataformaOperador` — sem
 * esse flag ninguém no banco acessa a área de Contas (AD-13). As duas escritas
 * entram na mesma transação do provisionamento.
 *
 * Uso: `npm run prisma:seed` (ou `prisma db seed`, ou automaticamente após
 * `prisma migrate dev`). Idempotente: se a Conta já existir (mesmo CNPJ),
 * o script encerra sem duplicar dados.
 *
 * Credenciais customizáveis via variáveis de ambiente. Todas têm um
 * fallback para rodar sem configuração extra em desenvolvimento, exceto
 * SEED_ADMIN_SENHA — obrigatória, sem valor padrão inseguro:
 *   SEED_CONTA_NOME, SEED_CONTA_CNPJ, SEED_ADMIN_NOME, SEED_ADMIN_EMAIL,
 *   SEED_ADMIN_SENHA (obrigatória)
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

// Import relativo: este script roda pelo `tsx`, fora do resolver de aliases do
// Next. O módulo alvo não importa `server-only` nem o singleton do Prisma
// justamente para poder ser carregado daqui.
import {
  OPCOES_DE_TRANSACAO_DE_PROVISIONAMENTO,
  provisionarContaEm,
} from "../src/server/repositories/provisionamento";

const prisma = new PrismaClient();

async function main() {
  const contaNome = process.env.SEED_CONTA_NOME ?? "Raiz";
  const contaCnpj = process.env.SEED_CONTA_CNPJ ?? "00.000.000/0001-00";
  const adminNome = process.env.SEED_ADMIN_NOME ?? "Administrador Raiz";
  // Normalizado como o produto normaliza (actions/usuario.ts,
  // actions/conta.ts): o e-mail é a chave única global da identidade, e semear
  // " Admin@Raiz.local " criaria uma linha que nenhuma busca do login acha.
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@raiz.local")
    .trim()
    .toLowerCase();
  const adminSenha = process.env.SEED_ADMIN_SENHA;
  if (!adminSenha) {
    throw new Error(
      "[seed] A variável de ambiente SEED_ADMIN_SENHA é obrigatória (sem valor padrão, por segurança). Defina-a antes de rodar o seed.",
    );
  }

  const contaExistente = await prisma.conta.findFirst({
    where: { cnpj: contaCnpj },
  });
  if (contaExistente) {
    console.log(
      `[seed] Conta "${contaExistente.nome}" (CNPJ ${contaCnpj}) já existe — nada a fazer.`,
    );
    return;
  }

  // O hash sai da transação de propósito: é CPU, não I/O de banco, e segurá-lo
  // dentro mantém a transação aberta à toa.
  const senhaHash = await hashPassword(adminSenha);

  const { conta, perfis } = await prisma.$transaction(async (tx) => {
    const { conta, perfis, identidadeNova } = await provisionarContaEm(tx, {
      conta: {
        nome: contaNome,
        cnpj: contaCnpj,
        // Explícitos, e iguais aos @default do schema (Essencial/Ativa) — a
        // conta raiz não depende de um default mudar de valor.
        planoContratado: "Essencial",
        status: "Ativa",
      },
      administrador: { nome: adminNome, email: adminEmail },
    });

    // A idempotência do seed é por CNPJ, não por e-mail. Sem esta recusa, um
    // SEED_ADMIN_EMAIL que já pertença a alguém sob OUTRO CNPJ seria
    // reaproveitado pelo convite e, nas escritas abaixo, receberia
    // isPlataformaOperador, status Ativo e uma credencial com a senha do seed —
    // entregando a plataforma inteira, com senha conhecida, a quem nunca
    // consentiu. O bootstrap só promove uma identidade que ELE acabou de criar.
    if (!identidadeNova) {
      throw new Error(
        `[seed] O e-mail ${adminEmail} já pertence a uma identidade nesta plataforma. ` +
          "O seed só cria o administrador raiz do zero — ele nunca promove nem redefine a senha " +
          "de alguém que já existe. Use outro SEED_ADMIN_EMAIL ou provisione a conta pela área de Contas.",
      );
    }

    // O provisionamento cria a identidade como `ConvitePendente`, sem senha —
    // é o que o convite normal faz. O seed vai além porque o administrador raiz
    // precisa entrar SEM receber e-mail nenhum: define a senha e já o deixa
    // Ativo.
    //
    // isPlataformaOperador: true — sem isso, ninguém no banco consegue acessar
    // a área de Contas do operador de plataforma (app/(plataforma), Story 1.4).
    // Independente do PerfilAcesso/can() (AD-13): este é o único usuário do
    // seed com o flag, exatamente para destravar essa área.
    const usuarioAdmin = await tx.usuario.update({
      where: { email: adminEmail },
      data: {
        emailVerified: true,
        status: "Ativo",
        isPlataformaOperador: true,
      },
      select: { id: true },
    });

    // `count` conferido, como todo compare-and-set deste épico: um vínculo que
    // ficasse ConvitePendente deixaria o administrador raiz sem acesso à conta
    // que o seed acabou de criar, e em silêncio.
    const vinculoPromovido = await tx.vinculoConta.updateMany({
      where: { usuarioId: usuarioAdmin.id, contaId: conta.id },
      data: { status: "Ativo" },
    });
    if (vinculoPromovido.count !== 1) {
      throw new Error(
        `[seed] Esperado exatamente 1 vínculo do administrador com a conta raiz, promovidos: ${vinculoPromovido.count}.`,
      );
    }

    // Credencial de login (e-mail/senha) — mesmo formato que o Better Auth usa
    // internamente ao criar uma conta via sign-up (providerId "credential",
    // accountId = id do usuário), usando o hash de senha padrão da própria lib
    // para garantir que o login funcione.
    await tx.account.create({
      data: {
        userId: usuarioAdmin.id,
        providerId: "credential",
        accountId: usuarioAdmin.id,
        password: senhaHash,
      },
    });

    return { conta, perfis };
  }, OPCOES_DE_TRANSACAO_DE_PROVISIONAMENTO);

  console.log(
    `[seed] Conta, Administrador e ${perfis.length} perfis de acesso criados:`,
  );
  console.log(`[seed]   Conta: ${conta.nome} (${conta.id})`);
  console.log(
    `[seed]   Administrador: ${adminEmail} (senha definida via SEED_ADMIN_SENHA)`,
  );
  console.log(
    `[seed]   Perfis: ${perfis.map((perfil) => perfil.nome).join(", ")}`,
  );
}

main()
  .catch((erro) => {
    console.error("[seed] Falha ao rodar o seed:", erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
