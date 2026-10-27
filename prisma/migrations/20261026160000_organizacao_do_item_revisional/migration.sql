-- Organização do item revisional para a OS impressa.
-- Migration escrita à mão (AD-5). Puramente ADITIVA: cinco colunas de texto
-- anuláveis, sem default e sem backfill — todo item já cadastrado continua
-- válido, com os cinco campos vazios, e nenhuma escrita existente muda.
--
-- Por que TEXTO LIVRE e não enum nem tabela de cadastro: o vocabulário é de
-- cada conta. "Elétrica/Mecânica/Administração frota" é de uma transportadora;
-- outra conta usa outro conjunto. Um enum no schema imporia o vocabulário de
-- um cliente a todos, e duas tabelas de cadastro custariam duas telas para um
-- campo que o relatório só agrupa. O formulário sugere os valores já usados na
-- conta (datalist), que é o que segura a divergência de grafia.
--
-- Sem índice: nenhuma consulta filtra por estas colunas — o agrupamento
-- acontece em memória, sobre os itens de UMA emissão (dezenas de linhas).
-- Índice aqui seria custo de escrita sem leitura que o justifique.

-- AlterTable
ALTER TABLE "itens_revisionais"
  ADD COLUMN "categoria" TEXT,
  ADD COLUMN "grupo"     TEXT,
  ADD COLUMN "etapa1"    TEXT,
  ADD COLUMN "etapa2"    TEXT,
  ADD COLUMN "etapa3"    TEXT;
