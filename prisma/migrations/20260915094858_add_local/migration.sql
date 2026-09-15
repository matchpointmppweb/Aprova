-- CreateEnum
CREATE TYPE "StatusLocal" AS ENUM ('Ativo', 'Inativo');

-- AlterEnum
ALTER TYPE "Modulo" ADD VALUE 'locais';

-- CreateTable
CREATE TABLE "locais" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "endereco" TEXT NOT NULL,
    "areaPoligono" JSONB,
    "status" "StatusLocal" NOT NULL DEFAULT 'Ativo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locais_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "locais_contaId_nome_key" ON "locais"("contaId", "nome");

-- AddForeignKey
ALTER TABLE "locais" ADD CONSTRAINT "locais_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
