-- Auditoria de troca de conta (Story 6.5).
--
-- É o que o AD-24 revisado se comprometeu a entregar no lugar da sessão nova; a
-- justificativa completa da revisão está em UM lugar só, `trocarDeContaAction`
-- (src/server/actions/auth.ts). Escrita SEMPRE na mesma transação da mudança da
-- conta ativa (AD-9).
--
-- Idempotente (mesmo padrão de 20260916120000_sessao_conta_ativa): a migration
-- pode ser reaplicada sobre um banco que já a recebeu sem falhar.
CREATE TABLE IF NOT EXISTS "trocas_de_conta" (
  "id" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  -- Nullable porque as FKs de conta são SET NULL (ver abaixo): apagar uma conta
  -- não pode apagar o histórico de quem passou por ela.
  "contaAnteriorId" TEXT,
  "contaNovaId" TEXT,
  -- Cópia do essencial no momento da troca: é o que sobra quando as FKs viram
  -- NULL, e também o que responde "de qual conta ela saiu?" depois de a conta
  -- ser renomeada. Nunca sincronizadas depois de escritas — o valor histórico é
  -- o ponto.
  "contaAnteriorNome" TEXT NOT NULL,
  "contaNovaNome" TEXT NOT NULL,
  "usuarioEmail" TEXT NOT NULL,
  -- O momento da troca. Não há `updatedAt`: registro de auditoria é fato
  -- consumado, nunca editado.
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "trocas_de_conta_pkey" PRIMARY KEY ("id")
);

-- A pergunta principal é "o que esta identidade fez, em ordem cronológica" —
-- daí o índice composto, e não um por coluna.
CREATE INDEX IF NOT EXISTS "trocas_de_conta_usuarioId_createdAt_idx"
  ON "trocas_de_conta"("usuarioId", "createdAt");

-- O Postgres NÃO indexa coluna referenciadora automaticamente: sem estes dois,
-- apagar uma Conta varre a tabela inteira para resolver o cascade, e a outra
-- pergunta natural da auditoria ("o que aconteceu NESTA conta") não tem índice
-- nenhum.
CREATE INDEX IF NOT EXISTS "trocas_de_conta_contaAnteriorId_idx"
  ON "trocas_de_conta"("contaAnteriorId");
CREATE INDEX IF NOT EXISTS "trocas_de_conta_contaNovaId_idx"
  ON "trocas_de_conta"("contaNovaId");

-- CASCADE na identidade é CONCESSÃO, não preferência: RESTRICT não é opção —
-- a migration de colapso da Story 6.3 apaga identidades perdedoras e um
-- RESTRICT aqui a quebraria. É por isso que "usuarioEmail" é copiado na linha.
DO $$
BEGIN
  ALTER TABLE "trocas_de_conta"
    ADD CONSTRAINT "trocas_de_conta_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- SET NULL nos dois lados de conta, e é o inverso da escolha acima: apagar uma
-- conta não pode apagar o histórico de quem passou por ela — é exatamente aí
-- que a auditoria serve para alguma coisa. O id vira NULL e os nomes copiados
-- na linha mantêm o registro legível. Mesma escolha (e motivo) do
-- "sessoes"."contaAtivaId".
DO $$
BEGIN
  ALTER TABLE "trocas_de_conta"
    ADD CONSTRAINT "trocas_de_conta_contaAnteriorId_fkey"
    FOREIGN KEY ("contaAnteriorId") REFERENCES "contas"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "trocas_de_conta"
    ADD CONSTRAINT "trocas_de_conta_contaNovaId_fkey"
    FOREIGN KEY ("contaNovaId") REFERENCES "contas"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
