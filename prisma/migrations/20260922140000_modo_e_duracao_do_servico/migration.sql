-- Story 7.1 — modo do lançamento e duração em minutos na linha de serviço.
-- Migration escrita à mão (AD-5). Aditiva: as duas colunas são anuláveis ou
-- têm DEFAULT, então toda escrita existente continua válida sem alteração.

-- CreateEnum
CREATE TYPE "ModoLancamentoServico" AS ENUM ('Duracao', 'Periodo');

-- AlterTable
-- O `DEFAULT 'Periodo'` É o backfill: as linhas já gravadas nascem com o modo
-- preenchido (com ou sem datas), e nenhuma fica com `modo` nulo.
ALTER TABLE "servicos_emissao" ADD COLUMN     "duracaoMinutos" INTEGER,
ADD COLUMN     "modo" "ModoLancamentoServico" NOT NULL DEFAULT 'Periodo';

-- AddCheckConstraint
-- Cobre SÓ a dimensão nova (Design Notes): `Periodo` continua aceitando linha
-- sem datas, porque a UI atual ainda produz esse caso e esta story é aditiva.
-- O aperto "período exige as duas datas" é da Story 7.3. Zero ou negativo
-- nunca é lançamento (NFR7).
ALTER TABLE "servicos_emissao" ADD CONSTRAINT "servicos_emissao_modo_coerente" CHECK (
  ("modo" = 'Duracao' AND "duracaoMinutos" IS NOT NULL AND "duracaoMinutos" > 0
     AND "inicio" IS NULL AND "fim" IS NULL)
  OR
  ("modo" = 'Periodo' AND "duracaoMinutos" IS NULL)
);
