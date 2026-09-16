/**
 * Bootstrap da primeira Conta, do primeiro Administrador e dos 4 perfis de
 * acesso padrão (Deferred da arquitetura — "Bootstrap da primeira Conta +
 * Administrador"). Não há auto-cadastro público: este script é a única via
 * de criação da Conta inicial.
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
import { Modulo, PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

const prisma = new PrismaClient();

type PermissoesPorModulo = Partial<
  Record<Modulo, { criar: boolean; editar: boolean; excluir: boolean }>
>;

const TODOS_OS_MODULOS: Modulo[] = [
  Modulo.ativos,
  Modulo.tipos,
  Modulo.itens,
  Modulo.planos,
  Modulo.emissao,
  Modulo.locais,
  Modulo.empresas,
  Modulo.cargos,
  Modulo.funcoes,
  Modulo.pessoas,
  Modulo.usuarios,
  Modulo.perfil,
  Modulo.aparencia,
];

// "contas" nunca aparece aqui — não é permissão configurável por conta-cliente
// (AD-13, perfis-de-acesso.md).
const ACESSO_TOTAL = { criar: true, editar: true, excluir: true } as const;
const SEM_ACESSO = { criar: false, editar: false, excluir: false } as const;

// Matriz extraída de perfis-de-acesso.md.
const PERFIS_PADRAO: {
  nome: string;
  descricao: string;
  permissoes: PermissoesPorModulo;
}[] = [
  {
    nome: "Administrador",
    descricao: "Acesso completo a todos os módulos.",
    permissoes: Object.fromEntries(
      TODOS_OS_MODULOS.map((modulo) => [modulo, ACESSO_TOTAL]),
    ),
  },
  {
    nome: "Técnico de manutenção",
    descricao:
      "Cadastra/edita ativos, edita itens e planos revisionais, cria e edita emissões.",
    permissoes: {
      ativos: { criar: true, editar: true, excluir: false },
      itens: { criar: false, editar: true, excluir: false },
      planos: { criar: false, editar: true, excluir: false },
      emissao: { criar: true, editar: true, excluir: false },
    },
  },
  {
    nome: "Inspetor",
    descricao: "Apenas edita emissões (fluxo de análise/aprovação).",
    permissoes: {
      emissao: { criar: false, editar: true, excluir: false },
    },
  },
  {
    nome: "Somente leitura",
    descricao: "Visualização em todos os módulos, sem nenhuma permissão de escrita.",
    permissoes: Object.fromEntries(
      TODOS_OS_MODULOS.map((modulo) => [modulo, SEM_ACESSO]),
    ),
  },
];

async function main() {
  const contaNome = process.env.SEED_CONTA_NOME ?? "Raiz";
  const contaCnpj = process.env.SEED_CONTA_CNPJ ?? "00.000.000/0001-00";
  const adminNome = process.env.SEED_ADMIN_NOME ?? "Administrador Raiz";
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@raiz.local";
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

  const conta = await prisma.conta.create({
    data: { nome: contaNome, cnpj: contaCnpj },
  });

  // Perfil + suas permissões nascem juntos, na mesma transação (AD-9 — não
  // se aplica a Story 1.1 em si, mas mantém o padrão desde já).
  const perfisCriados = await Promise.all(
    PERFIS_PADRAO.map((perfil) =>
      prisma.perfilAcesso.create({
        data: {
          contaId: conta.id,
          nome: perfil.nome,
          descricao: perfil.descricao,
          permissoes: {
            create: TODOS_OS_MODULOS.map((modulo) => ({
              modulo,
              ...(perfil.permissoes[modulo] ?? SEM_ACESSO),
            })),
          },
        },
      }),
    ),
  );

  const perfilAdministrador = perfisCriados.find(
    (perfil) => perfil.nome === "Administrador",
  );
  if (!perfilAdministrador) {
    throw new Error("[seed] Perfil Administrador não foi criado.");
  }

  // isPlataformaOperador: true — sem isso, ninguém no banco consegue acessar
  // a área de Contas do operador de plataforma (app/(plataforma), Story
  // 1.4). Independente do PerfilAcesso/can() (AD-13): este é o único
  // usuário do seed com o flag, exatamente para destravar essa área.
  const usuarioAdmin = await prisma.usuario.create({
    data: {
      nome: adminNome,
      email: adminEmail,
      emailVerified: true,
      status: "Ativo",
      isPlataformaOperador: true,
      // Vínculo usuário<->conta<->perfil (Story 6.1) criado no mesmo nested
      // create do usuário — atômico por natureza (AD-9), então um banco novo
      // já nasce consistente sem depender do backfill da migration.
      //
      // Story 6.3: conta e perfil de acesso vivem SÓ aqui — `Usuario` não tem
      // mais `contaId`/`perfilAcessoId`, e `email` é único em toda a
      // plataforma.
      vinculos: {
        create: {
          contaId: conta.id,
          perfilAcessoId: perfilAdministrador.id,
          status: "Ativo",
        },
      },
    },
  });

  // Credencial de login (e-mail/senha) — mesmo formato que o Better Auth usa
  // internamente ao criar uma conta via sign-up (providerId "credential",
  // accountId = id do usuário), usando o hash de senha padrão da própria lib
  // para garantir que o login funcione.
  const senhaHash = await hashPassword(adminSenha);
  await prisma.account.create({
    data: {
      userId: usuarioAdmin.id,
      providerId: "credential",
      accountId: usuarioAdmin.id,
      password: senhaHash,
    },
  });

  console.log("[seed] Conta, Administrador e 4 perfis de acesso criados:");
  console.log(`[seed]   Conta: ${conta.nome} (${conta.id})`);
  console.log(`[seed]   Administrador: ${adminEmail} (senha definida via SEED_ADMIN_SENHA)`);
  console.log(
    `[seed]   Perfis: ${perfisCriados.map((perfil) => perfil.nome).join(", ")}`,
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
