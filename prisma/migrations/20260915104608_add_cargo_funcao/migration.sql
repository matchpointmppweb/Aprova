-- CreateEnum
CREATE TYPE "StatusCargo" AS ENUM ('Ativo', 'Inativo');

-- CreateEnum
CREATE TYPE "StatusFuncao" AS ENUM ('Ativo', 'Inativo');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Modulo" ADD VALUE 'cargos';
ALTER TYPE "Modulo" ADD VALUE 'funcoes';

-- CreateTable
CREATE TABLE "cargos" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "status" "StatusCargo" NOT NULL DEFAULT 'Ativo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cargos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funcoes" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "status" "StatusFuncao" NOT NULL DEFAULT 'Ativo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funcoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cargos_contaId_descricao_key" ON "cargos"("contaId", "descricao");

-- CreateIndex
CREATE UNIQUE INDEX "funcoes_contaId_descricao_key" ON "funcoes"("contaId", "descricao");

-- AddForeignKey
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funcoes" ADD CONSTRAINT "funcoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
