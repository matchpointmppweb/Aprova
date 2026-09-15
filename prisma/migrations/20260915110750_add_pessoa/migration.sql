-- AlterEnum
ALTER TYPE "Modulo" ADD VALUE 'pessoas';

-- CreateTable
CREATE TABLE "pessoas" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "cargoId" TEXT NOT NULL,
    "funcaoId" TEXT NOT NULL,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pessoas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pessoas_cargoId_idx" ON "pessoas"("cargoId");

-- CreateIndex
CREATE INDEX "pessoas_funcaoId_idx" ON "pessoas"("funcaoId");

-- AddForeignKey
ALTER TABLE "pessoas" ADD CONSTRAINT "pessoas_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pessoas" ADD CONSTRAINT "pessoas_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "cargos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pessoas" ADD CONSTRAINT "pessoas_funcaoId_fkey" FOREIGN KEY ("funcaoId") REFERENCES "funcoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
