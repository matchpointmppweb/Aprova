-- Story 7.2 — teto da duração de um lançamento de serviço.
-- Migration escrita à mão (AD-5). Postgres não tem `ALTER CONSTRAINT` para
-- CHECK: a única forma de apertar a cláusula é DERRUBAR e RECRIAR.
--
-- A cláusula nova é mais ESTRITA que a da 7.1, então linhas já gravadas acima
-- do teto fariam a recriação falhar. É o comportamento certo: `servicos_emissao`
-- tem zero linhas em produção (verificado na 7.1), e falhar alto é melhor do
-- que gravar uma constraint NOT VALID que não protege nada.
--
-- O 44640 (31 dias) é o MESMO número de `TETO_DE_MINUTOS` em src/lib/duracao.ts.
-- Não há como o Prisma guardar essa igualdade (ele não modela CHECK), então
-- quem a guarda é o teste em tests/servico-emissao.test.ts, que compara os dois
-- lados contra o banco real.

ALTER TABLE "servicos_emissao" DROP CONSTRAINT "servicos_emissao_modo_coerente";

ALTER TABLE "servicos_emissao" ADD CONSTRAINT "servicos_emissao_modo_coerente" CHECK (
  ("modo" = 'Duracao' AND "duracaoMinutos" IS NOT NULL
     AND "duracaoMinutos" > 0 AND "duracaoMinutos" <= 44640
     AND "inicio" IS NULL AND "fim" IS NULL)
  OR
  ("modo" = 'Periodo' AND "duracaoMinutos" IS NULL)
);
