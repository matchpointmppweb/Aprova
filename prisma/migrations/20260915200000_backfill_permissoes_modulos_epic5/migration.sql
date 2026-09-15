-- Backfill de permissões dos módulos introduzidos pelo Epic 5.
--
-- Perfis criados antes do Epic 5 não possuem linha em "permissoes_de_modulo"
-- para locais/empresas/cargos/funcoes/pessoas. can() (src/server/auth/can.ts)
-- trata linha ausente como negação, então esses módulos nasceriam
-- inacessíveis em toda conta já existente -- inclusive para o perfil
-- "Administrador", que deveria ter acesso total.
--
-- Valores gerados, espelhando a matriz de prisma/seed.ts:
--   "Administrador" -> acesso total (criar/editar/excluir)
--   demais perfis   -> sem acesso, para não ampliar a permissão de ninguém
--                      silenciosamente; o ajuste fino fica na tela de Perfil
--                      de acesso.
--
-- Idempotente por construção (o LEFT JOIN ... IS NULL nunca toca numa linha
-- que já exista), e o próprio Prisma garante uma única aplicação por banco.
-- Módulos futuros exigem uma migration nova como esta: é a forma versionada
-- de corrigir dado existente, e não depende de ninguém rodar script à mão.

INSERT INTO "permissoes_de_modulo" ("id", "perfilAcessoId", "modulo", "criar", "editar", "excluir")
SELECT
  gen_random_uuid()::text,
  p."id",
  m."modulo",
  p."nome" = 'Administrador',
  p."nome" = 'Administrador',
  p."nome" = 'Administrador'
FROM "perfis_de_acesso" p
CROSS JOIN (
  VALUES
    ('locais'::"Modulo"),
    ('empresas'::"Modulo"),
    ('cargos'::"Modulo"),
    ('funcoes'::"Modulo"),
    ('pessoas'::"Modulo")
) AS m("modulo")
LEFT JOIN "permissoes_de_modulo" pm
  ON pm."perfilAcessoId" = p."id"
 AND pm."modulo" = m."modulo"
WHERE pm."id" IS NULL;
