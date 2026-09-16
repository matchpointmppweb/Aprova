-- Nome da pessoa NO VÍNCULO (Story 6.6).
--
-- A partir desta story, convidar um e-mail que já tem identidade cria apenas um
-- vínculo novo. Exibir o nome da IDENTIDADE nesse caso transformaria o convite
-- num oráculo: qualquer administrador descobriria o nome do dono de um e-mail
-- arbitrário só por convidá-lo. Com o nome no vínculo, cada conta rotula a
-- pessoa como a conhece e a identidade nunca é renomeada de fora (regra da 6.3).
--
-- Idempotente (mesmo padrão de 20260916160000_auditoria_troca_de_conta): a
-- migration pode ser reaplicada sobre um banco que já a recebeu sem falhar.

-- Nullable de propósito: os vínculos criados antes desta story continuam
-- válidos, e a leitura cai para o nome da identidade quando a coluna está
-- vazia.
ALTER TABLE "vinculos_de_conta" ADD COLUMN IF NOT EXISTS "nome" TEXT;

-- Backfill: copia o nome ATUAL da identidade para os vínculos já existentes,
-- para a listagem de Usuários não mudar de comportamento no deploy (AD-26). Só
-- toca linhas ainda nulas — é o que torna a reexecução inofensiva e o que
-- impede o backfill de sobrescrever um nome já gerenciado pela conta.
UPDATE "vinculos_de_conta" AS v
SET "nome" = u."nome"
FROM "usuarios" AS u
WHERE u."id" = v."usuarioId"
  AND v."nome" IS NULL;
