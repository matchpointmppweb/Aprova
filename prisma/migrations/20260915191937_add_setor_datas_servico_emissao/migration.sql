-- CreateEnum
CREATE TYPE "Setor" AS ENUM ('Manutencao', 'Producao', 'Logistica', 'SegurancaDoTrabalho', 'Administrativo');

-- AlterTable
ALTER TABLE "emissoes" ADD COLUMN     "dataAgendamento" TIMESTAMP(3),
ADD COLUMN     "dataFim" TIMESTAMP(3),
ADD COLUMN     "dataInicio" TIMESTAMP(3),
ADD COLUMN     "setor" "Setor" NOT NULL DEFAULT 'Manutencao';

-- CreateTable
CREATE TABLE "servicos_emissao" (
    "id" TEXT NOT NULL,
    "emissaoId" TEXT NOT NULL,
    "pessoaId" TEXT NOT NULL,
    "itemRevisionalId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3),
    "fim" TIMESTAMP(3),

    CONSTRAINT "servicos_emissao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "servicos_emissao_emissaoId_idx" ON "servicos_emissao"("emissaoId");

-- CreateIndex
CREATE INDEX "servicos_emissao_pessoaId_idx" ON "servicos_emissao"("pessoaId");

-- CreateIndex
CREATE INDEX "servicos_emissao_itemRevisionalId_idx" ON "servicos_emissao"("itemRevisionalId");

-- AddForeignKey
ALTER TABLE "servicos_emissao" ADD CONSTRAINT "servicos_emissao_emissaoId_fkey" FOREIGN KEY ("emissaoId") REFERENCES "emissoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicos_emissao" ADD CONSTRAINT "servicos_emissao_pessoaId_fkey" FOREIGN KEY ("pessoaId") REFERENCES "pessoas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicos_emissao" ADD CONSTRAINT "servicos_emissao_itemRevisionalId_fkey" FOREIGN KEY ("itemRevisionalId") REFERENCES "itens_revisionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
