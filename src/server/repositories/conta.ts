import "server-only";

import type { PlanoContratado, StatusConta } from "@prisma/client";

import { prisma } from "./db";
import {
  comRegrasDeCorrida,
  OPCOES_DE_TRANSACAO_DE_PROVISIONAMENTO,
  ProvisionamentoInconsistenteError,
  provisionarContaEm,
  type DadosDaConta,
  type ResultadoProvisionamento,
} from "./provisionamento";

// Único repositório de Conta (AD-13, Story 1.4) — Conta é a raiz do
// isolamento multi-tenant (AD-1), não filha dele: nenhuma função abaixo
// filtra por um contaId "do chamador". O isolamento real desta área vem do
// gate exigirOperadorDePlataforma() (server/auth/sessao.ts), nunca de um
// filtro de linha aqui.

// Listagem da área Contas (operador de plataforma): todas as contas-cliente
// da plataforma, com a contagem de usuários vinculados a cada uma (coluna
// "nº de usuários" do mockup).
//
// Story 6.3: `Conta.usuarios` deixou de existir — quem pertence a uma conta é
// dito pelo VinculoConta. A contagem passa a ser de `vinculos`, mas a FORMA do
// retorno é mantida (`_count.usuarios`) para que a tela do operador de
// plataforma (src/components/plataforma/) não precise mudar: a coluna continua
// significando "nº de usuários desta conta".
export async function listarContas() {
  const contas = await prisma.conta.findMany({
    include: { _count: { select: { vinculos: true } } },
    orderBy: { nome: "asc" },
  });

  return contas.map(({ _count, ...conta }) => ({
    ...conta,
    _count: { usuarios: _count.vinculos },
  }));
}

export async function buscarConta(contaId: string) {
  return prisma.conta.findUnique({ where: { id: contaId } });
}

// "Nova conta" (Story 6.7): criar uma conta é PROVISIONÁ-LA INTEIRA. A linha
// de Conta, os quatro perfis de acesso padrão — cada um com uma linha de
// permissão por módulo configurável — e o vínculo do primeiro Administrador
// são gravados na MESMA transação (AD-9): ou tudo, ou nada. Acabou a lacuna
// registrada desde a Story 1.4, em que a conta nascia sem perfis e sem
// ninguém capaz de entrar, e só era destravada mexendo no banco à mão.
//
// O corpo vive em `./provisionamento.ts` porque `prisma/seed.ts` — que roda
// fora do runtime do Next, com o próprio PrismaClient — executa exatamente a
// mesma função. Aqui só se abre a transação com o singleton.
//
// `enviarDefinicaoDeSenha` volta para a Server Action disparar o convite
// DEPOIS do commit: o e-mail é efeito externo e não participa da transação —
// uma falha no envio não pode desfazer um provisionamento já concluído.
// As regras de corrida são as MESMAS do convite avulso (comRegrasDeCorrida):
// um P2002 de `usuarios.email` — outra escrita criou a identidade no mesmo
// instante — reexecuta o provisionamento UMA vez em vez de devolver erro, que
// obrigaria o operador a redigitar os seis campos. Reexecutar é seguro porque a
// transação anterior foi inteiramente desfeita. Um P2002 do vínculo numa conta
// que acabou de nascer é estado impossível e vira erro, nunca sucesso parcial.
export async function criarConta(dados: {
  conta: DadosDaConta;
  administrador: { nome: string; email: string };
}): Promise<ResultadoProvisionamento> {
  return comRegrasDeCorrida(
    () =>
      prisma.$transaction(
        (tx) => provisionarContaEm(tx, dados),
        OPCOES_DE_TRANSACAO_DE_PROVISIONAMENTO,
      ),
    () => {
      throw new ProvisionamentoInconsistenteError(
        "Vínculo preexistente numa conta recém-criada.",
      );
    },
  );
}

// Edição: escopada por {id: contaId} — essa é a chave do alvo da edição, não
// um filtro de isolamento do chamador (a distinção que AD-13 exige). Retorna
// false (sem lançar) se a conta não existir, para a Server Action decidir a
// resposta sem expor detalhe interno.
export async function atualizarConta(
  contaId: string,
  dados: Partial<{
    nome: string;
    cnpj: string;
    planoContratado: PlanoContratado;
    status: StatusConta;
    // Aparência (CAP-11 / AD-11, Story 1.5) — validado contra
    // src/lib/paletas.ts antes de chegar aqui (atualizarPaletaAction);
    // este repositório não valida a chave, só grava.
    paletaDeCores: string;
  }>,
) {
  const resultado = await prisma.conta.updateMany({
    where: { id: contaId },
    data: dados,
  });
  return resultado.count > 0;
}
