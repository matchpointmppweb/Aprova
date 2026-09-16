-- Reexecução do backfill de `vinculos_de_conta` (Story 6.2) — requisito
-- bloqueante herdado da 6.1.
--
-- A partir desta story a conta ativa e o perfil de acesso passam a ser LIDOS
-- do vínculo, não mais de `Usuario.contaId`/`Usuario.perfilAcessoId`. Entre o
-- deploy da 6.1 (que criou a tabela e fez o backfill) e este, o deploy antigo
-- seguiu servindo tráfego e pôde criar usuários sem vínculo — o
-- `prisma migrate deploy` roda antes do `next build` e a virada não é
-- instantânea. Sem esta varredura, esses usuários perderiam acesso no exato
-- instante em que a leitura mudasse.
--
-- É o MESMO INSERT da migration 20260915210000_add_vinculo_conta, idempotente
-- por construção: o LEFT JOIN ... IS NULL nunca toca numa linha existente, de
-- modo que num banco já íntegro esta migration insere 0 linhas e não falha.
-- Nenhuma coluna de `usuarios` é tocada (a remoção delas é a Story 6.3).
INSERT INTO "vinculos_de_conta" ("id", "usuarioId", "contaId", "perfilAcessoId", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  u."id",
  u."contaId",
  u."perfilAcessoId",
  u."status",
  u."createdAt",
  u."updatedAt"
FROM "usuarios" u
LEFT JOIN "vinculos_de_conta" v
  ON v."usuarioId" = u."id"
 AND v."contaId" = u."contaId"
WHERE v."id" IS NULL;

-- Reconciliação: o INSERT acima é insert-only, então repara vínculo AUSENTE
-- mas nunca vínculo DEFASADO. A mesma janela de deploy rolante permite que o
-- deploy antigo (sem o dual-write da 6.1) tenha alterado
-- `usuarios.status`/`usuarios.perfilAcessoId` de alguém cujo vínculo já
-- existia, deixando a linha do vínculo velha. Como a partir desta story é o
-- vínculo que manda, um perfil defasado faria can() decidir errado e um status
-- defasado trancaria quem deveria ter acesso. `usuarios` ainda é a fonte de
-- verdade neste momento (as colunas só somem na Story 6.3), então a direção da
-- cópia é usuário -> vínculo.
--
-- `IS DISTINCT FROM` em vez de `<>`: ambas as colunas são NOT NULL hoje, mas
-- o operador é o correto para "diferente" e não vira NULL se isso mudar.
-- Também é o que mantém o UPDATE idempotente — num banco já reconciliado
-- nenhuma linha casa e nada é escrito (nem `updatedAt` é mexido).
UPDATE "vinculos_de_conta" v
SET "status" = u."status",
    "perfilAcessoId" = u."perfilAcessoId",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "usuarios" u
WHERE v."usuarioId" = u."id"
  AND v."contaId" = u."contaId"
  AND (
    v."status" IS DISTINCT FROM u."status"
    OR v."perfilAcessoId" IS DISTINCT FROM u."perfilAcessoId"
  );

-- Pós-condição: a partir do próximo deploy, um usuário sem vínculo não
-- consegue mais entrar. Falhar aqui aborta a transação da migration (e o
-- `npm run build`, que roda `prisma migrate deploy` antes do `next build`) em
-- vez de trancar gente em silêncio depois da virada da leitura.
DO $$
DECLARE
  orfaos INTEGER;
BEGIN
  SELECT COUNT(*) INTO orfaos
  FROM "usuarios" u
  LEFT JOIN "vinculos_de_conta" v
    ON v."usuarioId" = u."id"
   AND v."contaId" = u."contaId"
  WHERE v."id" IS NULL;

  IF orfaos > 0 THEN
    RAISE EXCEPTION
      'Backfill de vinculos_de_conta incompleto: % usuario(s) sem vinculo correspondente. A leitura de conta ativa passa a depender do vinculo (Story 6.2) — abortando antes de trancar esses usuarios.',
      orfaos;
  END IF;
END
$$;
