-- VinculoConta (Story 6.1) — fase expand da migração expand/contract que
-- transforma a associação usuário<->conta<->perfil em entidade própria.
--
-- A tabela nasce junto com o backfill no MESMO arquivo, de propósito: o
-- `prisma migrate deploy` que o script de build já roda é o único lugar em que
-- dado existente é corrigido de forma versionada (AD-26), sem nenhum passo
-- manual. Um banco com usuários pré-existentes sai desta migration com
-- exatamente um vínculo por usuário.
--
-- `Usuario.contaId`/`Usuario.perfilAcessoId` NÃO são tocados: continuam sendo
-- a fonte de verdade até as Stories 6.2/6.3.

-- CreateTable
CREATE TABLE "vinculos_de_conta" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "perfilAcessoId" TEXT NOT NULL,
    "status" "StatusUsuario" NOT NULL DEFAULT 'ConvitePendente',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vinculos_de_conta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vinculos_de_conta_contaId_idx" ON "vinculos_de_conta"("contaId");

-- CreateIndex
CREATE INDEX "vinculos_de_conta_perfilAcessoId_idx" ON "vinculos_de_conta"("perfilAcessoId");

-- CreateIndex
CREATE UNIQUE INDEX "vinculos_de_conta_usuarioId_contaId_key" ON "vinculos_de_conta"("usuarioId", "contaId");

-- AddForeignKey
ALTER TABLE "vinculos_de_conta" ADD CONSTRAINT "vinculos_de_conta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculos_de_conta" ADD CONSTRAINT "vinculos_de_conta_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "contas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculos_de_conta" ADD CONSTRAINT "vinculos_de_conta_perfilAcessoId_fkey" FOREIGN KEY ("perfilAcessoId") REFERENCES "perfis_de_acesso"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: um vínculo por usuário existente, espelhando conta, perfil e
-- status do próprio usuário. Idempotente por construção — o
-- LEFT JOIN ... IS NULL nunca toca numa linha que já exista, então reexecutar
-- este INSERT em banco já migrado insere 0 linhas e não falha (o Prisma já
-- garante uma única aplicação por banco; a idempotência é a rede de segurança
-- para bancos restaurados/copiados).
--
-- `id` vem de gen_random_uuid()::text e não do @default(cuid()) do schema:
-- cuid é gerado na aplicação, o banco não sabe produzi-lo (mesmo padrão da
-- migration 20260915200000_backfill_permissoes_modulos_epic5).
--
-- createdAt/updatedAt copiam os do usuário: o vínculo sempre existiu de fato
-- desde que o usuário existe, só não tinha linha própria até aqui.
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
