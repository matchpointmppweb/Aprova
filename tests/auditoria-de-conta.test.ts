import { beforeEach, describe, expect, test } from "vitest";

import {
  definirContaAtivaDaSessao,
  SEM_CONTA_ANTERIOR,
  trocarContaAtivaDaSessao,
} from "@/src/server/repositories/vinculo-conta";

import { criarAmbiente, criarConta, criarPerfil, criarVinculo, db, limparBanco } from "./setup/fixtures";

beforeEach(limparBanco);

// Diferido da Story 6.5, fechado em 02-11-2026: a escolha INICIAL de conta
// não entrava no histórico de auditoria. Uma sessão que entrava em A e
// trocava para B mostrava só "A -> B", sem nada dizendo quem a colocou em A —
// a trilha começava no meio da história, o que é o mesmo que não ter trilha
// para a pergunta "como essa pessoa chegou nesta conta?".
//
// Testado no REPOSITÓRIO, e não pela Server Action: a action depende de uma
// sessão autenticada por cookie, que não existe fora de uma requisição do
// Next. A regra vive na escrita, junto da transação que a torna atômica, e é
// nela que fica presa.

async function sessaoAberta(usuarioId: string) {
  return db.session.create({
    data: {
      userId: usuarioId,
      token: `token-${usuarioId}-${Date.now()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
}

describe("a primeira escolha de conta entra na trilha", () => {
  test("grava a conta ativa E uma linha de auditoria", async () => {
    const ambiente = await criarAmbiente();
    const sessao = await sessaoAberta(ambiente.identidade.id);

    const { count } = await definirContaAtivaDaSessao({
      sessaoId: sessao.id,
      usuarioId: ambiente.identidade.id,
      usuarioEmail: ambiente.identidade.email,
      contaId: ambiente.conta.id,
      contaNome: ambiente.conta.nome,
    });

    expect(count).toBe(1);
    const relida = await db.session.findUniqueOrThrow({ where: { id: sessao.id } });
    expect(relida.contaAtivaId).toBe(ambiente.conta.id);

    const trilha = await db.trocaDeConta.findMany({
      where: { usuarioId: ambiente.identidade.id },
    });
    expect(trilha).toHaveLength(1);
    expect(trilha[0].contaNovaId).toBe(ambiente.conta.id);
    expect(trilha[0].contaNovaNome).toBe(ambiente.conta.nome);
  });

  test("a conta anterior é NULA com nome sentinela, não vazia", async () => {
    // Três situações que a FK nula sozinha confunde: primeira escolha, conta
    // apagada depois (que mantém o nome copiado) e erro de gravação. O
    // sentinela é o que as distingue ao ler a trilha.
    const ambiente = await criarAmbiente();
    const sessao = await sessaoAberta(ambiente.identidade.id);

    await definirContaAtivaDaSessao({
      sessaoId: sessao.id,
      usuarioId: ambiente.identidade.id,
      usuarioEmail: ambiente.identidade.email,
      contaId: ambiente.conta.id,
      contaNome: ambiente.conta.nome,
    });

    const [linha] = await db.trocaDeConta.findMany({
      where: { usuarioId: ambiente.identidade.id },
    });
    expect(linha.contaAnteriorId).toBeNull();
    expect(linha.contaAnteriorNome).toBe(SEM_CONTA_ANTERIOR);
    expect(linha.usuarioEmail).toBe(ambiente.identidade.email);
    // Sobre a CONSTANTE, não só sobre a linha: comparar a gravação com o
    // próprio sentinela é tautológico — passava verde com ele virando "".
    // O que a trilha exige é um nome legível, e que não se confunda com uma
    // conta de verdade.
    expect(SEM_CONTA_ANTERIOR.trim().length).toBeGreaterThan(0);
    expect(SEM_CONTA_ANTERIOR).toContain("(");
  });

  test("sessão de OUTRA identidade não é tocada, e nada é auditado", async () => {
    // O `where` carrega `userId` de propósito. Sem ele, um id de sessão
    // forjado levaria a conta ativa de outra pessoa — e deixaria uma linha de
    // auditoria afirmando uma escolha que ela não fez.
    const dono = await criarAmbiente();
    const intruso = await criarAmbiente();
    const sessaoDoDono = await sessaoAberta(dono.identidade.id);

    const { count } = await definirContaAtivaDaSessao({
      sessaoId: sessaoDoDono.id,
      usuarioId: intruso.identidade.id,
      usuarioEmail: intruso.identidade.email,
      contaId: intruso.conta.id,
      contaNome: intruso.conta.nome,
    });

    expect(count).toBe(0);
    const relida = await db.session.findUniqueOrThrow({ where: { id: sessaoDoDono.id } });
    expect(relida.contaAtivaId).toBeNull();
    // A auditoria é parte da MESMA transação: recusa não deixa meia linha.
    expect(await db.trocaDeConta.count()).toBe(0);
  });

  test("a trilha fica COMPLETA depois de uma troca: nada começa no meio", async () => {
    // É o caso que motivou o diferido. Antes, esta leitura devolvia uma linha
    // só ("A -> B") e ninguém sabia como a pessoa chegou em A.
    const identidade = (await criarAmbiente()).identidade;
    const contaA = await criarConta();
    const contaB = await criarConta();
    await criarVinculo(identidade.id, contaA.id, (await criarPerfil(contaA.id)).id);
    await criarVinculo(identidade.id, contaB.id, (await criarPerfil(contaB.id)).id);
    const sessao = await sessaoAberta(identidade.id);

    await definirContaAtivaDaSessao({
      sessaoId: sessao.id,
      usuarioId: identidade.id,
      usuarioEmail: identidade.email,
      contaId: contaA.id,
      contaNome: contaA.nome,
    });
    await trocarContaAtivaDaSessao({
      sessaoId: sessao.id,
      usuarioId: identidade.id,
      usuarioEmail: identidade.email,
      contaAnteriorId: contaA.id,
      contaAnteriorNome: contaA.nome,
      contaNovaId: contaB.id,
      contaNovaNome: contaB.nome,
      promoverVinculo: false,
    });

    const trilha = await db.trocaDeConta.findMany({
      where: { usuarioId: identidade.id },
      orderBy: { createdAt: "asc" },
    });

    expect(trilha).toHaveLength(2);
    expect(trilha[0].contaAnteriorNome).toBe(SEM_CONTA_ANTERIOR);
    expect(trilha[0].contaNovaId).toBe(contaA.id);
    expect(trilha[1].contaAnteriorId).toBe(contaA.id);
    expect(trilha[1].contaNovaId).toBe(contaB.id);
  });
});
