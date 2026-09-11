-- CreateEnum
CREATE TYPE "StatusTipoAtivo" AS ENUM ('Ativo', 'Arquivado');

-- CreateTable
CREATE TABLE "tipos_de_ativo" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "status" "StatusTipoAtivo" NOT NULL DEFAULT 'Ativo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tipos_de_ativo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tipos_de_ativo_contaId_nome_key" ON "tipos_de_ativo"("contaId", "nome");

-- AddForeignKey
ALTER TABLE "tipos_de_ativo" ADD CONSTRAINT "tipos_de_ativo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
