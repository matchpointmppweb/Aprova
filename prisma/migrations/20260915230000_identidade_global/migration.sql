-- Identidade global por e-mail (Story 6.3) — fase **contract** do
-- expand/contract iniciado na 6.1 e cuja leitura virou na 6.2. É a única
-- transição irreversível do épico.
--
-- Tudo acontece dentro do `prisma migrate deploy` (AD-26), na ordem abaixo —
-- nenhum passo manual:
--   0. rede de segurança do backfill (ninguém chega ao colapso sem vínculo);
--   1. mapa perdedora -> vencedora pela regra determinística registrada;
--   2. reaponte de TODAS as referências às perdedoras (planos, emissões,
--      vínculos) ANTES de removê-las;
--   3. merge dos atributos de identidade das perdedoras na vencedora;
--   4. remoção de sessões/credenciais e, então, das próprias perdedoras;
--   5. unique global em `email` — DEPOIS do colapso;
--   6. remoção de `contaId`/`perfilAcessoId` de `usuarios`;
--   7. pós-condições que abortam o deploy em vez de deixar dado corrompido.
--
-- O arquivo é REEXECUTÁVEL: num banco já colapsado o mapa do passo 1 sai
-- vazio, os passos de dado viram no-op e o DDL é todo idempotente
-- (IF EXISTS/IF NOT EXISTS). Os dois passos que leem as colunas antigas rodam
-- por SQL dinâmico dentro de um DO, guardados pela existência da coluna —
-- SQL estático referenciando uma coluna já removida falharia ainda no parse,
-- antes de qualquer guarda.

-- `DROP COLUMN` toma ACCESS EXCLUSIVE sobre `usuarios` e o deploy anterior
-- continua servindo tráfego enquanto esta migration roda: sem limite, uma
-- transação longa em outro ponto seguraria o lock e TODA requisição ficaria
-- enfileirada atrás dele. Como o `prisma migrate deploy` roda a migration
-- inteira numa transação, estourar o timeout aborta tudo com segurança e o
-- deploy simplesmente falha — que é o resultado desejado.
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. Rede de segurança: nenhum usuário pode chegar ao colapso sem vínculo
-- ---------------------------------------------------------------------------
-- MESMO INSERT idempotente das migrations 20260915210000 e 20260915220000. O
-- deploy da 6.2 segue servindo tráfego enquanto esta migration roda (o
-- `prisma migrate deploy` acontece antes do `next build`), e o colapso abaixo
-- APAGA identidades: uma perdedora sem vínculo levaria junto a conta e o
-- perfil dela, que nesse momento não existiriam em lugar nenhum. Num banco já
-- íntegro este INSERT afeta 0 linhas.
--
-- Deliberadamente insert-only, diferente da 20260915220000: desde a Story 6.2
-- é o vínculo que manda na leitura, então reconciliar vínculo existente a
-- partir das colunas antigas (que esta migration está prestes a apagar)
-- poderia REGREDIR perfil/status corretos. Só o vínculo AUSENTE é criado.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'usuarios' AND column_name = 'contaId'
  ) THEN
    EXECUTE $backfill$
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
      WHERE v."id" IS NULL
    $backfill$;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Mapa perdedora -> vencedora (regra de colapso AD-26)
-- ---------------------------------------------------------------------------
-- Vence a identidade com `ultimoAcesso` mais recente; em empate ou ausência de
-- acesso nos dois lados, vence a mais antiga por `createdAt`. O terceiro
-- critério (`id`) nunca decide nada na prática — dois usuários com o MESMO
-- `createdAt` ao milissegundo e o mesmo e-mail —, mas sem ele o resultado do
-- colapso deixaria de ser determinístico justo no caso de empate total, que é
-- o que a story exige que seja idêntico em qualquer ambiente.
--
-- Agrupado por `email` exato, e não por `lower(email)`, porque é exatamente o
-- que o unique criado no passo 4 vai exigir: colapsar mais do que a constraint
-- pede seria apagar identidade sem necessidade. (A aplicação já normaliza todo
-- e-mail para minúsculas na entrada — src/server/actions/usuario.ts.)
--
-- Tabela TEMP de sessão (sem ON COMMIT DROP, que dependeria de a migration
-- rodar dentro de uma transação explícita), descartada no fim do arquivo.
--
-- `perdedoraTinhaCredencial` é capturado AQUI, antes de qualquer remoção:
-- depois do passo 4 a linha de `contas_de_login` da perdedora não existe mais,
-- e a pós-condição do passo 7 (vencedora que ficou sem nenhuma senha) não
-- teria como saber que havia uma. Por isso a tabela temporária só é destruída
-- no fim do arquivo, depois das pós-condições.
CREATE TEMP TABLE "colapso_identidades" AS
WITH ranqueadas AS (
  SELECT
    u."id",
    FIRST_VALUE(u."id") OVER (
      PARTITION BY u."email"
      ORDER BY u."ultimoAcesso" DESC NULLS LAST, u."createdAt" ASC, u."id" ASC
    ) AS "vencedoraId"
  FROM "usuarios" u
)
SELECT
  r."id" AS "perdedoraId",
  r."vencedoraId",
  EXISTS (
    SELECT 1 FROM "contas_de_login" a WHERE a."userId" = r."id"
  ) AS "perdedoraTinhaCredencial"
FROM ranqueadas r
WHERE r."id" <> r."vencedoraId";

-- ---------------------------------------------------------------------------
-- 2. Reaponte das referências às perdedoras (ANTES de removê-las)
-- ---------------------------------------------------------------------------
-- `PlanoRevisional.responsavelId` e `Emissao.responsavelId` continuam
-- apontando para `Usuario` (AD-25) — nunca para o vínculo. Sem este reaponte a
-- remoção das perdedoras violaria a FK (ou, pior num schema mais frouxo,
-- deixaria órfão).
-- `updatedAt` não é tocado de propósito: ele é o lock otimista da edição de
-- plano/emissão (@updatedAt é aplicado pelo Prisma, não por trigger). Bumpá-lo
-- aqui invalidaria, sem motivo, formulários abertos no momento do deploy.
UPDATE "planos_revisionais" p
SET "responsavelId" = c."vencedoraId"
FROM "colapso_identidades" c
WHERE p."responsavelId" = c."perdedoraId";

UPDATE "emissoes" e
SET "responsavelId" = c."vencedoraId"
FROM "colapso_identidades" c
WHERE e."responsavelId" = c."perdedoraId";

-- Vínculos das perdedoras passam a pertencer à vencedora, preservando a conta
-- e o PERFIL de cada um (é o que permite a mesma pessoa atender duas contas
-- com papéis diferentes — FR20/FR21).
--
-- `@@unique([usuarioId, contaId])` impede dois vínculos da mesma identidade na
-- mesma conta, então antes do reaponte é preciso escolher UM vínculo por
-- (identidade final, conta). A preferência é: o vínculo que já é da vencedora;
-- na ausência dele, o mais antigo entre os das perdedoras. Os demais são
-- removidos. (Com o `@@unique([contaId, email])` que ainda vigora aqui, duas
-- identidades do mesmo e-mail nunca estão na mesma conta — esta limpeza só
-- dispara se algum vínculo extra tiver sido criado por fora; é rede de
-- segurança, não caminho esperado.)
DELETE FROM "vinculos_de_conta" v
USING "colapso_identidades" c
WHERE v."usuarioId" = c."perdedoraId"
  AND v."id" <> (
    SELECT vv."id"
    FROM "vinculos_de_conta" vv
    LEFT JOIN "colapso_identidades" cc ON cc."perdedoraId" = vv."usuarioId"
    WHERE COALESCE(cc."vencedoraId", vv."usuarioId") = c."vencedoraId"
      AND vv."contaId" = v."contaId"
    ORDER BY (cc."perdedoraId" IS NULL) DESC, vv."createdAt" ASC, vv."id" ASC
    LIMIT 1
  );

UPDATE "vinculos_de_conta" v
SET "usuarioId" = c."vencedoraId",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "colapso_identidades" c
WHERE v."usuarioId" = c."perdedoraId";

-- ---------------------------------------------------------------------------
-- 3. Merge dos atributos de identidade das perdedoras na vencedora
-- ---------------------------------------------------------------------------
-- Nome e senha da vencedora prevalecem (regra registrada), mas os três campos
-- abaixo não são "preferência": são CAPACIDADES que, se descartadas junto com
-- a linha perdedora, somem para sempre e sem nenhuma pós-condição perceber.
-- Todos fazem merge por OU lógico — a vencedora recebe `true`/`Ativo` se
-- QUALQUER identidade colapsada daquele e-mail tinha:
--
--   - `isPlataformaOperador`: perder o flag apagaria de forma irreversível o
--     acesso à área de Contas do operador de plataforma. Isto NÃO é alterar a
--     política do AD-13 (nenhuma regra de autorização muda, nenhuma tela do
--     operador é tocada) — é preservar, na identidade que sobrevive, o flag
--     que a pessoa já tinha.
--   - `emailVerified`: é o mesmo e-mail nas duas linhas; verificado uma vez,
--     verificado para a identidade única.
--   - `status`: o status da identidade passa a ser o GLOBAL ("banida da
--     plataforma"), e o status POR CONTA é o do vínculo, preservado um a um
--     logo acima. Estar `Ativo` em ao menos uma conta significa justamente não
--     estar banida — deixar a vencedora `Inativo` trancaria a pessoa em TODAS
--     as contas dela de uma vez.
UPDATE "usuarios" u
SET "isPlataformaOperador" = u."isPlataformaOperador" OR m."isPlataformaOperador",
    "emailVerified"        = u."emailVerified" OR m."emailVerified",
    "status"               = CASE
                               WHEN u."status" = 'Ativo' OR m."temAlgumaAtiva"
                                 THEN 'Ativo'::"StatusUsuario"
                               ELSE u."status"
                             END
FROM (
  SELECT
    c."vencedoraId",
    bool_or(perdedora."isPlataformaOperador") AS "isPlataformaOperador",
    bool_or(perdedora."emailVerified")        AS "emailVerified",
    bool_or(perdedora."status" = 'Ativo')     AS "temAlgumaAtiva"
  FROM "colapso_identidades" c
  JOIN "usuarios" perdedora ON perdedora."id" = c."perdedoraId"
  GROUP BY c."vencedoraId"
) m
WHERE u."id" = m."vencedoraId";

-- ---------------------------------------------------------------------------
-- 4. Sessões e credenciais das perdedoras, e então as próprias perdedoras
-- ---------------------------------------------------------------------------
-- As duas FKs são ON DELETE CASCADE, então o DELETE de `usuarios` abaixo já
-- levaria estas linhas; os DELETEs explícitos existem para que a decisão fique
-- legível no próprio arquivo e não dependa de um detalhe do schema.
--
-- Consequência aceita e documentada (Intent): quem tinha e-mail duplicado
-- precisa entrar de novo, com a senha da identidade VENCEDORA. Manter duas
-- linhas de `contas_de_login` com hashes diferentes para o mesmo e-mail
-- reintroduziria exatamente a ambiguidade que esta story elimina.
DELETE FROM "sessoes" s
USING "colapso_identidades" c
WHERE s."userId" = c."perdedoraId";

DELETE FROM "contas_de_login" a
USING "colapso_identidades" c
WHERE a."userId" = c."perdedoraId";

DELETE FROM "usuarios" u
USING "colapso_identidades" c
WHERE u."id" = c."perdedoraId";

-- ---------------------------------------------------------------------------
-- 5. Unique global em `email` — só DEPOIS do colapso
-- ---------------------------------------------------------------------------
-- Se o colapso tiver deixado qualquer duplicata para trás, é aqui que o deploy
-- morre, antes de qualquer coluna ser removida.
DROP INDEX IF EXISTS "usuarios_contaId_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_email_key" ON "usuarios"("email");

-- ---------------------------------------------------------------------------
-- 6. `contaId`/`perfilAcessoId` saem de `usuarios`
-- ---------------------------------------------------------------------------
-- O vínculo criado na 6.1 e lido pela 6.2 passa a ser a única fonte desta
-- informação. `status`, `ultimoAcesso` e `isPlataformaOperador` permanecem na
-- identidade: `status` passa a significar o status GLOBAL dela (concluiu o
-- primeiro acesso; banida da plataforma), enquanto o status POR CONTA é o do
-- vínculo — o acesso exige `Ativo` nos dois, como a 6.2 já implementa.
ALTER TABLE "usuarios" DROP CONSTRAINT IF EXISTS "usuarios_contaId_fkey";
ALTER TABLE "usuarios" DROP CONSTRAINT IF EXISTS "usuarios_perfilAcessoId_fkey";
ALTER TABLE "usuarios" DROP COLUMN IF EXISTS "contaId";
ALTER TABLE "usuarios" DROP COLUMN IF EXISTS "perfilAcessoId";

-- ---------------------------------------------------------------------------
-- 7. Pós-condições — abortar o deploy é melhor que corromper dado em silêncio
-- ---------------------------------------------------------------------------
-- Mesmo padrão das migrations 20260915210000 e 20260915220000. Falhar aqui
-- aborta a migration e, com ela, o `npm run build` (que roda
-- `prisma migrate deploy` antes do `next build`).
DO $$
DECLARE
  duplicados INTEGER;
  planosOrfaos INTEGER;
  emissoesOrfas INTEGER;
  semVinculo INTEGER;
  semCredencial INTEGER;
  multivinculo INTEGER;
  contasSemAdmin INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicados
  FROM (
    SELECT "email" FROM "usuarios" GROUP BY "email" HAVING COUNT(*) > 1
  ) d;

  IF duplicados > 0 THEN
    RAISE EXCEPTION
      'Colapso de identidades incompleto: % e-mail(s) ainda duplicado(s) em usuarios. A identidade global por e-mail (Story 6.3) nao pode ser concluida — abortando.',
      duplicados;
  END IF;

  SELECT COUNT(*) INTO planosOrfaos
  FROM "planos_revisionais" p
  LEFT JOIN "usuarios" u ON u."id" = p."responsavelId"
  WHERE u."id" IS NULL;

  IF planosOrfaos > 0 THEN
    RAISE EXCEPTION
      'Reaponte incompleto: % plano(s) revisional(is) com responsavelId sem Usuario correspondente — abortando antes de deixar registro orfao.',
      planosOrfaos;
  END IF;

  SELECT COUNT(*) INTO emissoesOrfas
  FROM "emissoes" e
  LEFT JOIN "usuarios" u ON u."id" = e."responsavelId"
  WHERE u."id" IS NULL;

  IF emissoesOrfas > 0 THEN
    RAISE EXCEPTION
      'Reaponte incompleto: % emissao(oes) com responsavelId sem Usuario correspondente — abortando antes de deixar registro orfao.',
      emissoesOrfas;
  END IF;

  -- Sem `usuarios.contaId`, uma identidade sem NENHUM vínculo é uma pessoa que
  -- perdeu toda a informação de conta/perfil: não entra em lugar nenhum e não
  -- aparece em nenhuma listagem.
  SELECT COUNT(*) INTO semVinculo
  FROM "usuarios" u
  LEFT JOIN "vinculos_de_conta" v ON v."usuarioId" = u."id"
  WHERE v."id" IS NULL;

  IF semVinculo > 0 THEN
    RAISE EXCEPTION
      'Colapso deixou % identidade(s) sem nenhum vinculo — conta e perfil dessas pessoas deixariam de existir. Abortando.',
      semVinculo;
  END IF;

  -- A senha que sobrevive é a da VENCEDORA (regra registrada, e não se muda
  -- aqui). Só que a vencedora pode nunca ter definido uma: quando nenhuma das
  -- duplicadas tem `ultimoAcesso`, vence a mais antiga por `createdAt`, que
  -- pode ser um convite jamais aceito — enquanto a perdedora, essa sim, tinha
  -- credencial, apagada no passo 4. O resultado seria uma pessoa sem NENHUMA
  -- senha, em silêncio. Falhar o deploy é aceitável (o operador decide como
  -- resolver antes de tentar de novo); destruir a única senha não é.
  SELECT COUNT(*) INTO semCredencial
  FROM (
    SELECT DISTINCT c."vencedoraId"
    FROM "colapso_identidades" c
    WHERE c."perdedoraTinhaCredencial"
  ) v
  WHERE NOT EXISTS (
    SELECT 1 FROM "contas_de_login" a WHERE a."userId" = v."vencedoraId"
  );

  IF semCredencial > 0 THEN
    RAISE EXCEPTION
      'Colapso deixaria % identidade(s) sem nenhuma credencial: a vencedora nao tem senha definida e a(s) perdedora(s) tinha(m). Abortando antes de destruir a unica senha dessas pessoas.',
      semCredencial;
  END IF;

  -- Resultado ACEITO, mas que precisa aparecer no log do deploy: uma
  -- identidade com mais de um vínculo fica sem acesso (resolução fail-closed
  -- da Story 6.2) até a Story 6.4 existir. Não é motivo para abortar — é
  -- exatamente o que a story prevê —, mas o operador tem de saber o raio do
  -- estrago sem precisar ir consultar o banco.
  SELECT COUNT(*) INTO multivinculo
  FROM (
    SELECT "usuarioId" FROM "vinculos_de_conta" GROUP BY "usuarioId" HAVING COUNT(*) > 1
  ) m;

  IF multivinculo > 0 THEN
    RAISE NOTICE
      '[Story 6.3] % identidade(s) terminaram com mais de um vinculo e ficam SEM ACESSO (fail-closed) ate a Story 6.4 (escolha de conta). Resultado esperado e documentado.',
      multivinculo;
  END IF;

  -- Uma conta sem nenhum administrador capaz de ENTRAR não é recuperável pela
  -- aplicação (não há tela que conserte isso de fora). "Alcançável" soma os
  -- quatro critérios: vínculo Ativo, perfil "Administrador", identidade Ativa
  -- e identidade com exatamente UM vínculo — com dois, a resolução
  -- fail-closed nega o acesso dela e o administrador é só nominal.
  --
  -- Só contas que TÊM algum vínculo entram na checagem: uma conta recém-criada
  -- pelo operador de plataforma nasce deliberadamente sem usuário nenhum
  -- (limitação conhecida, registrada em deferred-work.md) e nunca teve
  -- administrador para esta migration tirar.
  SELECT COUNT(*) INTO contasSemAdmin
  FROM "contas" c
  WHERE EXISTS (SELECT 1 FROM "vinculos_de_conta" v WHERE v."contaId" = c."id")
    AND NOT EXISTS (
      SELECT 1
      FROM "vinculos_de_conta" v
      JOIN "perfis_de_acesso" pa ON pa."id" = v."perfilAcessoId"
      JOIN "usuarios" u ON u."id" = v."usuarioId"
      WHERE v."contaId" = c."id"
        AND v."status" = 'Ativo'
        AND pa."nome" = 'Administrador'
        AND u."status" = 'Ativo'
        AND (SELECT COUNT(*) FROM "vinculos_de_conta" vv WHERE vv."usuarioId" = u."id") = 1
    );

  IF contasSemAdmin > 0 THEN
    RAISE EXCEPTION
      'Colapso deixaria % conta(s) sem nenhum administrador capaz de entrar (vinculo Ativo + perfil Administrador + identidade Ativa + vinculo unico). Nao ha como consertar isso pela aplicacao — abortando.',
      contasSemAdmin;
  END IF;
END
$$;

-- Só agora: as pós-condições acima dependem de `perdedoraTinhaCredencial`.
DROP TABLE "colapso_identidades";
