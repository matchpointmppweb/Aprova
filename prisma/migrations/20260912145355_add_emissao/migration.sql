-- CreateEnum
CREATE TYPE "StatusEmissao" AS ENUM ('Rascunho', 'EmAnalise', 'Emitido', 'Reprovado');

-- CreateTable
CREATE TABLE "emissoes" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "ativoId" TEXT NOT NULL,
    "planoId" TEXT NOT NULL,
    "responsavelId" TEXT NOT NULL,
    "dataEmissao" TIMESTAMP(3) NOT NULL,
    "codigo" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "status" "StatusEmissao" NOT NULL DEFAULT 'Rascunho',
    "motivoReprovacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emissoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_executados_emissao" (
    "id" TEXT NOT NULL,
    "emissaoId" TEXT NOT NULL,
    "itemRevisionalId" TEXT NOT NULL,
    "executado" BOOLEAN NOT NULL DEFAULT false,
    "valorEsperadoDias" INTEGER,
    "valorEsperadoKm" INTEGER,
    "valorEsperadoHoras" INTEGER,
    "medicaoDias" INTEGER,
    "medicaoKm" INTEGER,
    "medicaoHoras" INTEGER,
    "observacao" TEXT,

    CONSTRAINT "itens_executados_emissao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emissoes_ativoId_idx" ON "emissoes"("ativoId");

-- CreateIndex
CREATE INDEX "emissoes_planoId_idx" ON "emissoes"("planoId");

-- CreateIndex
CREATE INDEX "emissoes_responsavelId_idx" ON "emissoes"("responsavelId");

-- CreateIndex
CREATE UNIQUE INDEX "emissoes_contaId_ano_seq_key" ON "emissoes"("contaId", "ano", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "itens_executados_emissao_emissaoId_itemRevisionalId_key" ON "itens_executados_emissao"("emissaoId", "itemRevisionalId");

-- AddForeignKey
ALTER TABLE "emissoes" ADD CONSTRAINT "emissoes_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emissoes" ADD CONSTRAINT "emissoes_ativoId_fkey" FOREIGN KEY ("ativoId") REFERENCES "ativos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emissoes" ADD CONSTRAINT "emissoes_planoId_fkey" FOREIGN KEY ("planoId") REFERENCES "planos_revisionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emissoes" ADD CONSTRAINT "emissoes_responsavelId_fkey" FOREIGN KEY ("responsavelId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_executados_emissao" ADD CONSTRAINT "itens_executados_emissao_emissaoId_fkey" FOREIGN KEY ("emissaoId") REFERENCES "emissoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_executados_emissao" ADD CONSTRAINT "itens_executados_emissao_itemRevisionalId_fkey" FOREIGN KEY ("itemRevisionalId") REFERENCES "itens_revisionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
