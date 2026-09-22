-- Contenção de força bruta em login e recuperação de senha (adiado desde a
-- Story 1.1; alcançável desde que o app passou a ser publicamente exposto).
--
-- Tabela nova e isolada: nada existente lê ou escreve nela, então esta
-- migration é puramente aditiva e não tem janela de risco no deploy contínuo.

CREATE TABLE "tentativas_de_acesso" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_de_acesso_pkey" PRIMARY KEY ("id")
);

-- A única consulta é "quantas falhas desta chave depois de tal instante", e a
-- limpeza apaga por "criadoEm" antigo. As três colunas nesta ordem servem às
-- duas: prefixo (tipo, chave) para a contagem, "criadoEm" para o corte.
CREATE INDEX "tentativas_de_acesso_tipo_chave_criadoEm_idx"
    ON "tentativas_de_acesso"("tipo", "chave", "criadoEm");
