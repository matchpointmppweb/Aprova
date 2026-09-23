-- Story 7.3 — o ramo `Periodo` da CHECK fica coerente com `duracaoDoPeriodo`.
-- Migration escrita à mão (AD-5). Postgres não tem `ALTER CONSTRAINT` para
-- CHECK: a única forma de apertar a cláusula é DERRUBAR e RECRIAR.
--
-- Até aqui o ramo `Periodo` só exigia `duracaoMinutos IS NULL` — a 7.1 o deixou
-- frouxo DE PROPÓSITO, porque a UI daquela época ainda produzia linha de
-- serviço sem datas. A 7.3 é o que permite apertá-lo: a Server Action passa a
-- exigir os dois marcos e a validar o intervalo com `duracaoDoPeriodo` ANTES de
-- qualquer escrita, então a CHECK é REDE, não caminho.
--
-- A cláusula recusa EXATAMENTE o que `src/lib/duracao.ts` recusa, nem mais nem
-- menos (Design Notes): marcos ausentes, fim não posterior ao início, intervalo
-- acima do teto. Recusar mais criaria período que a tela aceita e o banco
-- rejeita; recusar menos deixaria voltar a existir linha que o módulo não sabe
-- ler.
--
-- O 44640 (31 dias) é o MESMO número de `TETO_DE_MINUTOS`, nos DOIS ramos — é o
-- que o AC "é o mesmo número nos três" exige. O Prisma não modela CHECK, então
-- quem guarda a igualdade é `tests/servico-emissao.test.ts`, contra banco real.
--
-- Mais estrita que a anterior: uma linha `Periodo` já gravada sem datas faria a
-- recriação FALHAR. É o comportamento certo — `servicos_emissao` tem zero
-- linhas em produção (verificado na 7.1), e falhar alto é melhor do que uma
-- constraint NOT VALID que não protege nada.

ALTER TABLE "servicos_emissao" DROP CONSTRAINT "servicos_emissao_modo_coerente";

ALTER TABLE "servicos_emissao" ADD CONSTRAINT "servicos_emissao_modo_coerente" CHECK (
  ("modo" = 'Duracao' AND "duracaoMinutos" IS NOT NULL
     AND "duracaoMinutos" > 0 AND "duracaoMinutos" <= 44640
     AND "inicio" IS NULL AND "fim" IS NULL)
  OR
  ("modo" = 'Periodo' AND "duracaoMinutos" IS NULL
     AND "inicio" IS NOT NULL AND "fim" IS NOT NULL
     AND "fim" > "inicio"
     AND "fim" <= "inicio" + INTERVAL '44640 minutes')
);
