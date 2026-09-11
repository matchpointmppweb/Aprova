-- CreateEnum
CREATE TYPE "PlanoContratado" AS ENUM ('Essencial', 'Corporativo');

-- CreateEnum
CREATE TYPE "StatusConta" AS ENUM ('Ativa', 'PagamentoPendente');

-- CreateEnum
CREATE TYPE "StatusUsuario" AS ENUM ('Ativo', 'ConvitePendente', 'Inativo');

-- CreateEnum
CREATE TYPE "Modulo" AS ENUM ('ativos', 'tipos', 'itens', 'planos', 'emissao', 'usuarios', 'contas', 'perfil', 'aparencia');

-- CreateTable
CREATE TABLE "contas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "planoContratado" "PlanoContratado" NOT NULL DEFAULT 'Essencial',
    "status" "StatusConta" NOT NULL DEFAULT 'Ativa',
    "paletaDeCores" TEXT NOT NULL DEFAULT 'verde-floresta',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "status" "StatusUsuario" NOT NULL DEFAULT 'Ativo',
    "ultimoAcesso" TIMESTAMP(3),
    "isPlataformaOperador" BOOLEAN NOT NULL DEFAULT false,
    "contaId" TEXT NOT NULL,
    "perfilAcessoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessoes" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_de_login" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "password" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_de_login_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verificacoes" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perfis_de_acesso" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perfis_de_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissoes_de_modulo" (
    "id" TEXT NOT NULL,
    "perfilAcessoId" TEXT NOT NULL,
    "modulo" "Modulo" NOT NULL,
    "criar" BOOLEAN NOT NULL DEFAULT false,
    "editar" BOOLEAN NOT NULL DEFAULT false,
    "excluir" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permissoes_de_modulo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_contaId_email_key" ON "usuarios"("contaId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_token_key" ON "sessoes"("token");

-- CreateIndex
CREATE UNIQUE INDEX "contas_de_login_providerId_accountId_key" ON "contas_de_login"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "verificacoes_identifier_idx" ON "verificacoes"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "perfis_de_acesso_contaId_nome_key" ON "perfis_de_acesso"("contaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "permissoes_de_modulo_perfilAcessoId_modulo_key" ON "permissoes_de_modulo"("perfilAcessoId", "modulo");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_perfilAcessoId_fkey" FOREIGN KEY ("perfilAcessoId") REFERENCES "perfis_de_acesso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_de_login" ADD CONSTRAINT "contas_de_login_userId_fkey" FOREIGN KEY ("userId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfis_de_acesso" ADD CONSTRAINT "perfis_de_acesso_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissoes_de_modulo" ADD CONSTRAINT "permissoes_de_modulo_perfilAcessoId_fkey" FOREIGN KEY ("perfilAcessoId") REFERENCES "perfis_de_acesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
