import { beforeEach, describe, expect, test } from "vitest";

import { MS_POR_DIA, resolverAtivosDoPlano } from "@/src/server/repositories/plano";

import {
  criarAmbiente,
  criarAtivo,
  criarItemRevisional,
  criarTipoAtivo,
  db,
  limparBanco,
} from "./setup/fixtures";

beforeEach(limparBanco);

// A próxima revisão contava sempre da ENTRADA do ativo, sem olhar o histórico
// de emissões. Consequência: qualquer ativo mais velho que o intervalo do seu
// plano aparecia Atrasado para sempre — com dez revisões concluídas ou com
// nenhuma —, e nada o trazia de volta para No prazo. A tela de Planos, que
// existe para dizer o que fazer hoje, ficava inteira vermelha e sem
// informação. Achado ao semear dados de demonstração (05-11-2026).
//
// Estes testes prendem as quatro bordas da correção: que a emissão aprovada
// adia, que ela adia só o item que executou, que rascunho e análise NÃO
// adiam, e que a mais recente é a que vale.

const HOJE = new Date();

function diasAtras(dias: number): Date {
  return new Date(HOJE.getTime() - dias * MS_POR_DIA);
}

/// Cenário: um ativo que entrou há 400 dias, com um plano de um item de 90
/// dias. Sem nenhuma emissão ele está atrasado em mais de 300 dias — é a
/// situação exata que ficava presa.
async function cenario(opcoes: { diasDeEntrada?: number; diasPadrao?: number } = {}) {
  const ambiente = await criarAmbiente();
  const tipo = await criarTipoAtivo(ambiente.conta.id);
  const ativo = await db.ativo.create({
    data: {
      contaId: ambiente.conta.id,
      tipoAtivoId: tipo.id,
      nome: "Ativo antigo",
      localizacao: "Pátio",
      codigo: `AT-${Date.now()}`,
      createdAt: diasAtras(opcoes.diasDeEntrada ?? 400),
    },
  });
  const item = await db.itemRevisional.create({
    data: {
      contaId: ambiente.conta.id,
      nome: `Item ${Date.now()}`,
      diasPadrao: opcoes.diasPadrao ?? 90,
    },
  });
  const plano = await db.planoRevisional.create({
    data: {
      contaId: ambiente.conta.id,
      ativoId: ativo.id,
      responsavelId: ambiente.identidade.id,
      nome: `Plano ${Date.now()}`,
      itens: { create: [{ itemRevisionalId: item.id }] },
    },
  });

  return { ambiente, tipo, ativo, item, plano };
}

let sequencial = 0;

/// Emissão gravada pelo client próprio dos testes, nunca pela action: um
/// defeito na escrita do código de produção não pode mascarar a si mesmo
/// montando o cenário.
async function emitir(
  c: Awaited<ReturnType<typeof cenario>>,
  opcoes: {
    diasAtras: number;
    status?: "Rascunho" | "EmAnalise" | "Emitido" | "Reprovado";
    itemRevisionalId?: string;
    executado?: boolean;
  },
) {
  const ano = 2026;
  sequencial += 1;
  return db.emissao.create({
    data: {
      contaId: c.ambiente.conta.id,
      ativoId: c.ativo.id,
      planoId: c.plano.id,
      responsavelId: c.ambiente.identidade.id,
      dataEmissao: diasAtras(opcoes.diasAtras),
      codigo: `EM-${ano}-${String(sequencial).padStart(4, "0")}`,
      ano,
      seq: sequencial,
      status: opcoes.status ?? "Emitido",
      itens: {
        create: [
          {
            itemRevisionalId: opcoes.itemRevisionalId ?? c.item.id,
            executado: opcoes.executado ?? true,
          },
        ],
      },
    },
  });
}

async function resolucao(c: Awaited<ReturnType<typeof cenario>>) {
  const linhas = await resolverAtivosDoPlano(c.ambiente.conta.id, c.plano.id);
  expect(linhas).toHaveLength(1);
  return linhas[0];
}

/// Dias entre a próxima revisão e hoje. Positivo = ainda vai vencer.
function emQuantosDias(proximaData: Date | null): number {
  if (proximaData === null) throw new Error("proximaData nula");
  return Math.round((proximaData.getTime() - HOJE.getTime()) / MS_POR_DIA);
}

describe("próxima revisão depois de uma emissão", () => {
  test("sem emissão nenhuma, conta da entrada do ativo", () => {
    // A base do contraste: este caso NÃO muda, e é o que mantém honesto o
    // resto. Um ativo que nunca foi revisado tem de continuar atrasado.
    return cenario().then(async (c) => {
      const linha = await resolucao(c);
      expect(emQuantosDias(linha.proximaData)).toBe(-310); // 90 - 400
      expect(linha.pendente).toBe(true);
    });
  });

  test("uma emissão aprovada reabre o prazo", async () => {
    const c = await cenario();
    await emitir(c, { diasAtras: 10 });

    const linha = await resolucao(c);
    // 10 dias atrás + 90 de intervalo = vence em 80 dias.
    expect(emQuantosDias(linha.proximaData)).toBe(80);
    expect(linha.pendente).toBe(false);
  });

  test("a emissão MAIS RECENTE é a que vale", async () => {
    const c = await cenario();
    await emitir(c, { diasAtras: 200 });
    await emitir(c, { diasAtras: 5 });
    await emitir(c, { diasAtras: 120 });

    const linha = await resolucao(c);
    // A de 5 dias atrás vence as outras duas, independentemente da ordem em
    // que a consulta as devolveu.
    expect(emQuantosDias(linha.proximaData)).toBe(85);
  });

  test("rascunho NÃO reabre o prazo", async () => {
    const c = await cenario();
    await emitir(c, { diasAtras: 10, status: "Rascunho" });

    const linha = await resolucao(c);
    // Continua contando da entrada: serviço não aprovado não adia revisão,
    // senão daria para zerar a pendência de um ativo sem concluir nada.
    expect(emQuantosDias(linha.proximaData)).toBe(-310);
    expect(linha.pendente).toBe(true);
  });

  test("emissão em análise NÃO reabre o prazo", async () => {
    const c = await cenario();
    await emitir(c, { diasAtras: 10, status: "EmAnalise" });

    expect(emQuantosDias((await resolucao(c)).proximaData)).toBe(-310);
  });

  test("emissão reprovada NÃO reabre o prazo", async () => {
    const c = await cenario();
    await emitir(c, { diasAtras: 10, status: "Reprovado" });

    expect(emQuantosDias((await resolucao(c)).proximaData)).toBe(-310);
  });

  test("item NÃO executado dentro de uma emissão aprovada não reabre o prazo", async () => {
    const c = await cenario();
    // A emissão saiu, mas este item ficou desmarcado: ninguém o fez.
    await emitir(c, { diasAtras: 10, executado: false });

    expect(emQuantosDias((await resolucao(c)).proximaData)).toBe(-310);
  });

  test("a emissão adia só o item que executou, e o outro continua vencendo", async () => {
    const c = await cenario();
    // Segundo item no mesmo plano, de intervalo mais curto.
    const outro = await db.itemRevisional.create({
      data: { contaId: c.ambiente.conta.id, nome: `Outro ${Date.now()}`, diasPadrao: 30 },
    });
    await db.planoItemRevisional.create({
      data: { planoId: c.plano.id, itemRevisionalId: outro.id },
    });

    // Executou só o item de 90 dias.
    await emitir(c, { diasAtras: 10 });

    const linha = await resolucao(c);
    // O menor prazo entre os dois itens manda, e o item de 30 dias nunca foi
    // executado: continua contando da entrada do ativo (30 - 400 = -370).
    // Se a correção tivesse adiado os dois, viria 20 (30 - 10).
    expect(emQuantosDias(linha.proximaData)).toBe(-370);
    expect(linha.pendente).toBe(true);
  });

  test("a emissão de OUTRO ativo não reabre o prazo deste", async () => {
    const c = await cenario();
    // Mesmo plano por tipo, dois ativos: adiar um não pode adiar o vizinho.
    const vizinho = await criarAtivo(c.ambiente.conta.id, c.tipo.id);
    await db.planoRevisional.update({
      where: { id: c.plano.id },
      data: { ativoId: null, tipoAtivoId: c.tipo.id },
    });
    await emitir(c, { diasAtras: 10 });

    const linhas = await resolverAtivosDoPlano(c.ambiente.conta.id, c.plano.id);
    const doVizinho = linhas.find((l) => l.ativoId === vizinho.id);
    const doAntigo = linhas.find((l) => l.ativoId === c.ativo.id);

    expect(emQuantosDias(doAntigo?.proximaData ?? null)).toBe(80);
    // O vizinho acabou de ser criado, então conta da própria entrada.
    expect(emQuantosDias(doVizinho?.proximaData ?? null)).toBe(90);
  });

  test("item sem controle de dias continua sem próxima revisão", async () => {
    // `criarItemRevisional` cria com horasPadrao e sem diasPadrao: o plano
    // inteiro fica sem data, e uma emissão aprovada não pode inventar uma.
    const ambiente = await criarAmbiente();
    const tipo = await criarTipoAtivo(ambiente.conta.id);
    const ativo = await criarAtivo(ambiente.conta.id, tipo.id);
    const item = await criarItemRevisional(ambiente.conta.id);
    const plano = await db.planoRevisional.create({
      data: {
        contaId: ambiente.conta.id,
        ativoId: ativo.id,
        responsavelId: ambiente.identidade.id,
        nome: `Plano ${Date.now()}`,
        itens: { create: [{ itemRevisionalId: item.id }] },
      },
    });

    const linhas = await resolverAtivosDoPlano(ambiente.conta.id, plano.id);
    expect(linhas[0].proximaData).toBeNull();
    expect(linhas[0].pendente).toBe(false);
  });

  test("o override de dias do plano manda sobre o padrão do item", async () => {
    const c = await cenario({ diasPadrao: 90 });
    await db.planoItemRevisional.updateMany({
      where: { planoId: c.plano.id, itemRevisionalId: c.item.id },
      data: { diasOverride: 30 },
    });
    await emitir(c, { diasAtras: 10 });

    // 10 dias atrás + 30 do override = vence em 20 dias, não em 80.
    expect(emQuantosDias((await resolucao(c)).proximaData)).toBe(20);
  });

  test("a emissão de outra CONTA não reabre o prazo (AD-1)", async () => {
    const c = await cenario();
    const outra = await cenario();
    await emitir(outra, { diasAtras: 10 });

    expect(emQuantosDias((await resolucao(c)).proximaData)).toBe(-310);
  });

  // NOTA, apurada por mutação: remover o `contaId` da consulta de histórico
  // deixa este teste VERDE. O motivo é que a chave do histórico é
  // (ativoId, planoId, itemRevisionalId), e esses ids já são únicos entre
  // contas — o filtro de conta não é o que mantém o resultado correto aqui.
  //
  // O filtro fica, por duas razões que não são esta: ele evita varrer as
  // emissões de todas as contas a cada abertura da tela, e AD-1 exige que
  // toda leitura seja escopada, não apenas as em que a falta do escopo
  // produziria um número errado. O teste acima descreve o comportamento
  // esperado; ele não prende o filtro, e dizer o contrário seria falso.
});
