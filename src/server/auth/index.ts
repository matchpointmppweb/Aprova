import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { prisma } from "@/src/server/repositories/db";
import { logarLinkDeDefinicaoDeSenha } from "./email";

/**
 * Better Auth — credentials (e-mail/senha), sessão em banco (revogável,
 * carrega contaId) e fluxo de reset de senha (CAP-10, AD-1, AD-3).
 *
 * O modelo "user" do Better Auth é o `Usuario` do domínio (Prisma). O campo
 * interno `name` é mapeado para a coluna `nome`; os campos próprios do
 * domínio (isPlataformaOperador, status, ultimoAcesso) são declarados como
 * additionalFields para não serem descartados na saída de
 * auth.api.getSession().
 *
 * `contaId`/`perfilAcessoId` NÃO estão aqui de propósito (Story 6.2): a conta
 * ativa e o perfil são resolvidos pelo VinculoConta, revalidado contra o banco
 * a cada requisição (NFR6), em
 * src/server/repositories/vinculo-conta.ts -> exigirUsuarioAutenticado(). A
 * Story 6.3 removeu de vez essas colunas de `usuarios`; mesmo enquanto
 * existiam, expô-las na sessão daria cobertura a uma Server Action que lesse
 * `sessao.user.contaId` e contornasse a resolução pelo vínculo — inclusive
 * servindo uma conta cujo vínculo já foi desativado. Da sessão sai apenas a
 * identidade (`id`).
 *
 * Não existe cadastro público (bootstrap só via prisma/seed.ts; convite de
 * usuário é a Story 1.2) — sign-up fica desabilitado no Better Auth.
 */
export const auth = betterAuth({
  appName: "Raiz",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  session: {
    // Sessão em banco (não JWT-only), revogável — 7 dias.
    expiresIn: 60 * 60 * 24 * 7,
  },
  user: {
    modelName: "usuario",
    fields: {
      name: "nome",
    },
    additionalFields: {
      isPlataformaOperador: {
        type: "boolean",
        input: false,
        defaultValue: false,
      },
      status: { type: "string", input: false },
      ultimoAcesso: { type: "date", input: false, required: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    // Sem auto-cadastro: a primeira Conta/Administrador vem do seed, novos
    // usuários vêm do convite (Story 1.2) — nunca de um formulário público.
    disableSignUp: true,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      // Modo desenvolvimento (decisão confirmada para esta story): loga o
      // link no console/terminal em vez de enviar via Resend. A integração
      // real do Resend é uma história/tarefa futura. Este mesmo callback é
      // acionado tanto por "esqueci minha senha" quanto pelo convite de
      // usuário (Story 1.2, via auth.api.requestPasswordReset).
      await logarLinkDeDefinicaoDeSenha(user.email, url);
    },
  },
  plugins: [
    // Precisa ser o último plugin (grava os cookies de sessão a partir das
    // Server Actions/Route Handlers do App Router).
    nextCookies(),
  ],
});
