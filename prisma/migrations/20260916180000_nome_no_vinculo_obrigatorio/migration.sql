-- `vinculos_de_conta"."nome"` passa a ser OBRIGATÓRIO (Story 6.6).
--
-- A coluna nasceu nullable na migration anterior só para os vínculos criados
-- antes desta story sobreviverem ao backfill. Deixá-la assim para sempre é risco
-- com consequência nomeada: um vínculo criado sem nome não falha — ele REABRE o
-- vazamento que a story fechou, porque a queda de leitura é justamente para o
-- nome da identidade. NOT NULL faz o TypeScript cobrar o campo em todo ponto de
-- criação novo, que é por onde o vazamento voltaria a entrar.
--
-- Idempotente: reexecutar não falha.

-- Backfill defensivo, repetindo o da migration anterior: cobre qualquer linha
-- criada ENTRE os dois deploys por uma versão do código que ainda não preenchia
-- a coluna. Sem ele, o ALTER abaixo falharia no meio do deploy.
UPDATE "vinculos_de_conta" AS v
SET "nome" = u."nome"
FROM "usuarios" AS u
WHERE u."id" = v."usuarioId"
  AND v."nome" IS NULL;

-- Rede de segurança para o caso impossível de uma linha órfã (identidade
-- apagada é CASCADE, então não deveria existir): sem isto o ALTER derrubaria o
-- deploy por causa de uma única linha inconsistente.
UPDATE "vinculos_de_conta" SET "nome" = '' WHERE "nome" IS NULL;

DO $$
BEGIN
  ALTER TABLE "vinculos_de_conta" ALTER COLUMN "nome" SET NOT NULL;
END
$$;
