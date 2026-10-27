-- Frente A — a Empresa deixa de ser uma ilha.
-- Migration escrita à mão (AD-5). Duas mudanças independentes:
--
-- 1. `ativos.empresaId` — a empresa PROPRIETÁRIA do ativo. Opcional, e é o
--    que torna esta migration segura sobre dado pré-existente: o ativo que
--    já está em produção nasce sem dona em vez de barrar a aplicação.
--
-- 2. `planos_revisionais.empresaId` — o TERCEIRO lado do vínculo exclusivo.
--    Até aqui o XOR era entre duas colunas e vivia só na Server Action
--    (sem CHECK, verificado na 7.5). Com três colunas as combinações
--    inválidas passam de 2 para 5 — as três duplas, a tripla e a vazia — e
--    deixar isso só na aplicação significa que QUALQUER caminho de escrita
--    futuro pode gravar um plano que a derivação não sabe ler. Por isso a
--    CHECK entra agora, junto com a coluna que cria o problema.
--
-- A CHECK é REDE, não caminho: `validarVinculoXor` recusa antes, com
-- mensagem de campo (NFR7/AD-30). Quem a guarda são os testes contra banco
-- real — o Prisma não modela CHECK e a checagem de deriva não a enxerga.
--
-- Pós-condição verificada em produção antes de escrever: 1 ativo e 1 plano,
-- o plano vinculado por ativo. Nenhuma linha existente viola a cláusula, que
-- é por construção verdadeira para todo plano gravado até aqui (exatamente
-- um entre ativoId/tipoAtivoId já era garantido pela Server Action).

-- AlterTable
ALTER TABLE "ativos" ADD COLUMN "empresaId" TEXT;

-- AlterTable
ALTER TABLE "planos_revisionais" ADD COLUMN "empresaId" TEXT;

-- CreateIndex
CREATE INDEX "ativos_empresaId_idx" ON "ativos"("empresaId");

-- CreateIndex
CREATE INDEX "planos_revisionais_empresaId_idx" ON "planos_revisionais"("empresaId");

-- AddForeignKey
-- ON DELETE SET NULL acompanha as FKs opcionais já existentes em
-- planos_revisionais (ativoId/tipoAtivoId). Na prática nunca dispara:
-- Empresa não tem exclusão física (AD-10/AD-17, nem tem ação de excluir).
ALTER TABLE "ativos" ADD CONSTRAINT "ativos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planos_revisionais" ADD CONSTRAINT "planos_revisionais_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraint
-- Exatamente UM dos três vínculos. Escrito como soma de booleanos em vez de
-- uma cadeia de OR: a soma diz a regra ("um, e só um") de forma que
-- acrescentar um quarto vínculo amanhã seja uma linha a mais, não uma
-- reescrita da cláusula inteira.
ALTER TABLE "planos_revisionais" ADD CONSTRAINT "planos_revisionais_vinculo_exclusivo" CHECK (
  (("ativoId" IS NOT NULL)::int + ("tipoAtivoId" IS NOT NULL)::int + ("empresaId" IS NOT NULL)::int) = 1
);
