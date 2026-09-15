-- AlterEnum
ALTER TYPE "Modulo" ADD VALUE 'empresas';

-- CreateTable
CREATE TABLE "empresas" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "nomeFantasia" TEXT NOT NULL,
    "cnpj" TEXT,
    "cpf" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresas_contaId_razaoSocial_key" ON "empresas"("contaId", "razaoSocial");

-- AddForeignKey
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
