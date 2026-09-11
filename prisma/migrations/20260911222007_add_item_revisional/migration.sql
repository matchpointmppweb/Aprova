-- CreateEnum
CREATE TYPE "StatusItemRevisional" AS ENUM ('Ativo', 'Arquivado');

-- CreateTable
CREATE TABLE "itens_revisionais" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "diasPadrao" INTEGER,
    "kmPadrao" INTEGER,
    "horasPadrao" INTEGER,
    "status" "StatusItemRevisional" NOT NULL DEFAULT 'Ativo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "itens_revisionais_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "itens_revisionais_contaId_nome_key" ON "itens_revisionais"("contaId", "nome");

-- AddForeignKey
ALTER TABLE "itens_revisionais" ADD CONSTRAINT "itens_revisionais_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
