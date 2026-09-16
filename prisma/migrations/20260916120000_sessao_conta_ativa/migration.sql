-- Conta ativa da SESSÃO (Story 6.4).
--
-- Desde a 6.3 uma identidade pode ter vínculo utilizável em mais de uma conta,
-- e a resolução fail-closed nega o acesso justamente a quem tem mais de um.
-- A coluna abaixo é onde a escolha feita na tela de seleção passa a viver.
--
-- Nullable de propósito e sem backfill: a sessão nasce sem conta ativa (o
-- Better Auth cria a linha antes de qualquer escolha) e quem tem um único
-- vínculo utilizável nunca precisa dela — nesse caso a conta ativa é DERIVADA
-- do vínculo único a cada requisição. Toda sessão já existente continua
-- válida: fica com NULL e cai na derivação (um vínculo) ou na tela de seleção
-- (vários), sem ser derrubada.
--
-- A coluna NUNCA autoriza sozinha: a guarda de sessão revalida contra o banco,
-- a cada requisição, que o vínculo daquela identidade com aquela conta existe
-- e está utilizável (NFR6) — por isso não há, nem deve haver, constraint
-- tentando amarrar sessão a vínculo aqui.
ALTER TABLE "sessoes" ADD COLUMN IF NOT EXISTS "contaAtivaId" TEXT;

-- Índice pela conta: é o que permite localizar/limpar em bloco as sessões
-- apontadas para uma conta (e o que o ON DELETE SET NULL abaixo percorre
-- quando uma conta é removida).
CREATE INDEX IF NOT EXISTS "sessoes_contaAtivaId_idx" ON "sessoes"("contaAtivaId");

-- SET NULL, não CASCADE: apagar uma conta não pode apagar a linha de sessão de
-- quem estava nela — a pessoa perde o ambiente, não a autenticação. Com NULL
-- ela cai na seleção (se tiver outro vínculo) ou no login, pela guarda.
DO $$
BEGIN
  ALTER TABLE "sessoes"
    ADD CONSTRAINT "sessoes_contaAtivaId_fkey"
    FOREIGN KEY ("contaAtivaId") REFERENCES "contas"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
