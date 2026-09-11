-- CreateEnum
CREATE TYPE "StatusAtivo" AS ENUM ('Ativo', 'Inativo', 'Bloqueado', 'Vendido');

-- CreateTable
CREATE TABLE "ativos" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipoAtivoId" TEXT NOT NULL,
    "localizacao" TEXT NOT NULL,
    "numeroSerie" TEXT,
    "codigo" TEXT NOT NULL,
    "status" "StatusAtivo" NOT NULL DEFAULT 'Ativo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ativos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ativos_contaId_codigo_key" ON "ativos"("contaId", "codigo");

-- AddForeignKey
ALTER TABLE "ativos" ADD CONSTRAINT "ativos_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ativos" ADD CONSTRAINT "ativos_tipoAtivoId_fkey" FOREIGN KEY ("tipoAtivoId") REFERENCES "tipos_de_ativo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
