-- CreateEnum
CREATE TYPE "StatusPlanoRevisional" AS ENUM ('Ativo', 'Arquivado');

-- CreateTable
CREATE TABLE "planos_revisionais" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativoId" TEXT,
    "tipoAtivoId" TEXT,
    "responsavelId" TEXT NOT NULL,
    "status" "StatusPlanoRevisional" NOT NULL DEFAULT 'Ativo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planos_revisionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plano_itens_revisionais" (
    "id" TEXT NOT NULL,
    "planoId" TEXT NOT NULL,
    "itemRevisionalId" TEXT NOT NULL,
    "diasOverride" INTEGER,
    "kmOverride" INTEGER,
    "horasOverride" INTEGER,

    CONSTRAINT "plano_itens_revisionais_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planos_revisionais_ativoId_idx" ON "planos_revisionais"("ativoId");

-- CreateIndex
CREATE INDEX "planos_revisionais_tipoAtivoId_idx" ON "planos_revisionais"("tipoAtivoId");

-- CreateIndex
CREATE INDEX "planos_revisionais_responsavelId_idx" ON "planos_revisionais"("responsavelId");

-- CreateIndex
CREATE UNIQUE INDEX "planos_revisionais_contaId_nome_key" ON "planos_revisionais"("contaId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "plano_itens_revisionais_planoId_itemRevisionalId_key" ON "plano_itens_revisionais"("planoId", "itemRevisionalId");

-- AddForeignKey
ALTER TABLE "planos_revisionais" ADD CONSTRAINT "planos_revisionais_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planos_revisionais" ADD CONSTRAINT "planos_revisionais_ativoId_fkey" FOREIGN KEY ("ativoId") REFERENCES "ativos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planos_revisionais" ADD CONSTRAINT "planos_revisionais_tipoAtivoId_fkey" FOREIGN KEY ("tipoAtivoId") REFERENCES "tipos_de_ativo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planos_revisionais" ADD CONSTRAINT "planos_revisionais_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_itens_revisionais" ADD CONSTRAINT "plano_itens_revisionais_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "planos_revisionais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_itens_revisionais" ADD CONSTRAINT "plano_itens_revisionais_itemRevisionalId_fkey" FOREIGN KEY ("itemRevisionalId") REFERENCES "itens_revisionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
