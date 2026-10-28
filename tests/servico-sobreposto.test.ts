import { describe, expect, test } from "vitest";

import {
  ERRO_SERVICO_SOBREPOSTO,
  sobreposicoesDeServico,
  validarServicos,
  type LinhaServicoBruta,
} from "@/src/server/actions/emissao-estado";

// Decisão do Fulvi (27-10-2026): sobreposição de horário da mesma pessoa é
// ERRO, não suspeita. Nada impedia um duplo clique de somar as mesmas horas
// duas vezes — e como o total é derivado (AD-29), o engano chegava ao
// relatório de serviços por pessoa sem deixar rastro.

const ANA = "p-ana";
const BRUNO = "p-bruno";
const ITEM = "ir-1";
const OUTRO_ITEM = "ir-2";

function periodo(indice: number, pessoaId: string, de: string, ate: string) {
  return { indice, pessoaId, inicio: new Date(`${de}Z`), fim: new Date(`${ate}Z`) };
}

describe("sobreposicoesDeServico", () => {
  test("mesma pessoa com horários encavalados é recusada", () => {
    const erros = sobreposicoesDeServico([
      periodo(0, ANA, "2026-01-15T08:00", "2026-01-15T10:00"),
      periodo(1, ANA, "2026-01-15T09:00", "2026-01-15T11:00"),
    ]);
    expect(erros).toEqual([{ field: "servico-1-inicio", message: ERRO_SERVICO_SOBREPOSTO }]);
  });

  test("o erro acusa a linha POSTERIOR, não a que já estava certa", () => {
    // Culpar a primeira mandaria o foco do modal para um lançamento que a
    // pessoa não acabou de mexer.
    const erros = sobreposicoesDeServico([
      periodo(7, ANA, "2026-01-15T08:00", "2026-01-15T10:00"),
      periodo(9, ANA, "2026-01-15T09:00", "2026-01-15T09:30"),
    ]);
    expect(erros.map((e) => e.field)).toEqual(["servico-9-inicio"]);
  });

  test("encostar NÃO é sobrepor: fim 10:00 e início 10:00 convivem", () => {
    // É a jornada partida em dois itens — o caso normal. Uma comparação com
    // `<=` recusaria o dia inteiro de trabalho sequencial.
    expect(
      sobreposicoesDeServico([
        periodo(0, ANA, "2026-01-15T08:00", "2026-01-15T10:00"),
        periodo(1, ANA, "2026-01-15T10:00", "2026-01-15T12:00"),
      ]),
    ).toEqual([]);
  });

  test("pessoas DIFERENTES no mesmo horário convivem", () => {
    // O vizinho que distingue a regra de um simples "dois períodos cruzados":
    // duas pessoas na mesma OS ao mesmo tempo é o caso esperado.
    expect(
      sobreposicoesDeServico([
        periodo(0, ANA, "2026-01-15T08:00", "2026-01-15T10:00"),
        periodo(1, BRUNO, "2026-01-15T08:00", "2026-01-15T10:00"),
      ]),
    ).toEqual([]);
  });

  test("contido inteiramente dentro do outro também é sobreposição", () => {
    expect(
      sobreposicoesDeServico([
        periodo(0, ANA, "2026-01-15T08:00", "2026-01-15T18:00"),
        periodo(1, ANA, "2026-01-15T09:00", "2026-01-15T09:15"),
      ]),
    ).toHaveLength(1);
  });

  test("em dias diferentes não há sobreposição", () => {
    expect(
      sobreposicoesDeServico([
        periodo(0, ANA, "2026-01-15T08:00", "2026-01-15T10:00"),
        periodo(1, ANA, "2026-01-16T08:00", "2026-01-16T10:00"),
      ]),
    ).toEqual([]);
  });

  test("três encavalados marcam três linhas, não seis mensagens", () => {
    const erros = sobreposicoesDeServico([
      periodo(0, ANA, "2026-01-15T08:00", "2026-01-15T12:00"),
      periodo(1, ANA, "2026-01-15T09:00", "2026-01-15T13:00"),
      periodo(2, ANA, "2026-01-15T10:00", "2026-01-15T14:00"),
    ]);
    expect(erros.map((e) => e.field)).toEqual(["servico-1-inicio", "servico-2-inicio"]);
  });

  test("nenhum lançamento, nenhum erro", () => {
    expect(sobreposicoesDeServico([])).toEqual([]);
  });
});

function linha(indice: number, campos: Partial<LinhaServicoBruta>): LinhaServicoBruta {
  return {
    indice,
    pessoaId: ANA,
    itemRevisionalId: ITEM,
    modo: "Periodo",
    horas: "",
    inicio: "",
    fim: "",
    ...campos,
  };
}

describe("validarServicos aplica a regra", () => {
  test("duplicata exata do mesmo lançamento é recusada", () => {
    // O duplo clique, que é o caso que motivou a regra.
    const { erros } = validarServicos([
      linha(0, { inicio: "2026-01-15T08:00", fim: "2026-01-15T10:00" }),
      linha(1, { inicio: "2026-01-15T08:00", fim: "2026-01-15T10:00" }),
    ]);
    expect(erros).toEqual([{ field: "servico-1-inicio", message: ERRO_SERVICO_SOBREPOSTO }]);
  });

  test("a mesma pessoa em ITENS diferentes, no mesmo horário, também é recusada", () => {
    // Trabalhar dois itens simultaneamente é tão impossível quanto repetir o
    // mesmo: a regra é sobre a PESSOA, não sobre o item.
    const { erros } = validarServicos([
      linha(0, { inicio: "2026-01-15T08:00", fim: "2026-01-15T10:00" }),
      linha(1, {
        itemRevisionalId: OUTRO_ITEM,
        inicio: "2026-01-15T09:00",
        fim: "2026-01-15T10:00",
      }),
    ]);
    expect(erros.map((e) => e.field)).toEqual(["servico-1-inicio"]);
  });

  test("lançamentos por DURAÇÃO nunca sobrepõem — não têm hora no relógio", () => {
    // AD-28: o modo Duracao guarda quanto tempo levou, jamais quando. Julgar
    // sobreposição ali seria inventar um horário que ninguém informou.
    const { erros, servicos } = validarServicos([
      linha(0, { modo: "Duracao", horas: "2:00" }),
      linha(1, { modo: "Duracao", horas: "2:00" }),
    ]);
    expect(erros).toEqual([]);
    expect(servicos).toHaveLength(2);
  });

  test("linha com horário inválido não gera acusação de sobreposição", () => {
    // Só o erro de formato aparece: acusar encavalamento com um horário que
    // não foi lido seria opinar sobre o que não se sabe.
    const { erros } = validarServicos([
      linha(0, { inicio: "2026-01-15T08:00", fim: "2026-01-15T10:00" }),
      linha(1, { inicio: "2026-01-15T25:00", fim: "2026-01-15T10:00" }),
    ]);
    expect(erros.every((e) => e.message !== ERRO_SERVICO_SOBREPOSTO)).toBe(true);
  });

  test("jornada sequencial legítima continua passando inteira", () => {
    const { erros, servicos } = validarServicos([
      linha(0, { inicio: "2026-01-15T08:00", fim: "2026-01-15T10:00" }),
      linha(1, { itemRevisionalId: OUTRO_ITEM, inicio: "2026-01-15T10:00", fim: "2026-01-15T12:00" }),
      linha(2, { pessoaId: BRUNO, inicio: "2026-01-15T08:00", fim: "2026-01-15T12:00" }),
    ]);
    expect(erros).toEqual([]);
    expect(servicos).toHaveLength(3);
  });
});
