-- Remove as três colunas de etapa do item revisional.
-- Migration escrita à mão (AD-5).
--
-- Por que sair: as etapas vieram das prints de OS de um TMS que Fulvi enviou
-- como MODELO VISUAL. Ele confirmou em 27-10-2026 que não fazem parte do
-- fluxo dele — eram convenção daquele outro sistema — e pediu para tirá-las,
-- com a ressalva de que pode vir a pedi-las no futuro. Campo que ninguém
-- preenche não é neutro: ocupa espaço no cadastro e coluna no papel.
--
-- `categoria` e `grupo`, da MESMA migration que trouxe as etapas
-- (20261026160000), FICAM: são o que dá seções e primeira coluna ao
-- relatório, e Fulvi não os questionou.
--
-- DROP COLUMN é destrutivo e AD-10 (nunca DELETE físico) vale para LINHAS de
-- negócio, não para coluna que sai do modelo. Ainda assim foi conferido em
-- produção, por consulta somente leitura, ANTES de escrever esta migration:
-- 3 itens revisionais, ZERO com qualquer etapa preenchida. Nada se perde.
-- As colunas existiram por um dia (subiram no commit 9c622ff, em 26-10-2026).
--
-- Se um dia voltarem, voltam como migration nova — esta não é revertida.

-- AlterTable
ALTER TABLE "itens_revisionais"
  DROP COLUMN "etapa1",
  DROP COLUMN "etapa2",
  DROP COLUMN "etapa3";
