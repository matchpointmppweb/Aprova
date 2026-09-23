import { describe, expect, test } from "vitest";

import {
  DURACAO_INVALIDA,
  TETO_DE_MINUTOS,
  duracaoDoPeriodo,
  formatarMinutos,
  interpretarDuracao,
  somarMinutos,
} from "@/src/lib/duracao";

// Story 7.2 — o módulo é PURO, então estes testes não tocam o banco nem o
// `limparBanco` dos irmãos: são a matriz de casos inteira, em milissegundos.
// O que eles protegem é a diferença entre recusar e devolver zero — o ponto da
// NFR7, e exatamente onde o mockup erra.

describe("interpretarDuracao", () => {
  test.each([
    ["1:55", 115],
    ["1h55", 115],
    ["1H55", 115],
    [" 1:55 ", 115],
    ["1 : 55", 115],
    ["1h", 60],
    ["1:", 60],
    ["2", 120],
    ["0:30", 30],
    ["1:05", 65],
    ["1:5", 65],
  ])("%s vale %i minutos", (texto, minutos) => {
    expect(interpretarDuracao(texto)).toEqual({ tipo: "ok", minutos });
  });

  // Nenhum destes pode virar 0: um 0 silencioso desaparece dentro do total.
  test.each(["abc", "", "   ", "-5", "1:70", "1:99", "1:2:3", "1,5", "h30"])(
    "%s é recusado por formato",
    (texto) => {
      expect(interpretarDuracao(texto)).toEqual({
        tipo: "recusado",
        motivo: "formato-invalido",
      });
    },
  );

  test.each(["0", "0:00", "0h", "0h00"])("%s é recusado por não positivo", (texto) => {
    expect(interpretarDuracao(texto)).toEqual({
      tipo: "recusado",
      motivo: "nao-positivo",
    });
  });

  // Inclui "10000": número longo é falha de TETO, não de formato — a regex não
  // pode ser o que recusa, senão a mensagem culpa a digitação.
  test.each(["745h", "10000", "9999999"])("%s é recusado por teto", (texto) => {
    // 745h = 44.700 min, 60 acima do teto.
    expect(interpretarDuracao(texto)).toEqual({
      tipo: "recusado",
      motivo: "acima-do-teto",
    });
  });

  // A fronteira exata, nos dois lados — sem isto, um `>=` no lugar de `>`
  // passaria despercebido.
  test("o teto em si é aceito; um minuto além, não", () => {
    expect(interpretarDuracao(`${TETO_DE_MINUTOS / 60}:00`)).toEqual({
      tipo: "ok",
      minutos: TETO_DE_MINUTOS,
    });
    expect(interpretarDuracao(`${TETO_DE_MINUTOS / 60}:01`)).toEqual({
      tipo: "recusado",
      motivo: "acima-do-teto",
    });
  });
});

describe("duracaoDoPeriodo", () => {
  const as = (h: number, m = 0, dia = 15) => new Date(Date.UTC(2026, 0, dia, h, m));

  test("período válido vira os minutos entre os marcos", () => {
    expect(duracaoDoPeriodo(as(8), as(9, 55))).toEqual({ tipo: "ok", minutos: 115 });
  });

  test("período que atravessa a meia-noite conta pelas datas", () => {
    // O mockup tem um `minutosEntreHoras` que soma 24h quando a diferença fica
    // negativa. Aqui os marcos são data+hora, e a virada já está nas datas —
    // este caso prova que não há salto inventado.
    expect(duracaoDoPeriodo(as(23, 30, 15), as(0, 30, 16))).toEqual({
      tipo: "ok",
      minutos: 60,
    });
  });

  test("período invertido é recusado por ordem, nunca 0", () => {
    expect(duracaoDoPeriodo(as(9, 55), as(8))).toEqual({
      tipo: "recusado",
      motivo: "periodo-invertido",
    });
  });

  test("fim igual ao início é recusado por não positivo", () => {
    expect(duracaoDoPeriodo(as(8), as(8))).toEqual({
      tipo: "recusado",
      motivo: "nao-positivo",
    });
  });

  test("período acima do teto é recusado", () => {
    // 32 dias entre os marcos.
    expect(duracaoDoPeriodo(as(8, 0, 1), as(8, 0, 33))).toEqual({
      tipo: "recusado",
      motivo: "acima-do-teto",
    });
  });

  // Menos de um minuto entre os marcos. A unidade do domínio é o minuto
  // inteiro, então isto não é lançamento — e o motivo é o mesmo do período de
  // duração zero, de propósito.
  test("período abaixo de um minuto é recusado por não positivo", () => {
    const inicio = new Date(Date.UTC(2026, 0, 15, 8, 0, 0));
    const fim = new Date(Date.UTC(2026, 0, 15, 8, 0, 20));
    expect(duracaoDoPeriodo(inicio, fim)).toEqual({
      tipo: "recusado",
      motivo: "nao-positivo",
    });
  });

  // Os dois lados: numa tela o FIM é o último campo preenchido, e é o mais
  // provável de chegar meio digitado.
  test.each([
    ["início", new Date("nada"), as(8)],
    ["fim", as(8), new Date("nada")],
  ] as const)("%s inválido é recusado por formato", (_qual, inicio, fim) => {
    expect(duracaoDoPeriodo(inicio, fim)).toEqual({
      tipo: "recusado",
      motivo: "formato-invalido",
    });
  });
});

describe("formatarMinutos", () => {
  test.each([
    [115, "1:55"],
    [60, "1:00"],
    [0, "0:00"],
    [5, "0:05"],
    // Acima de 24h continua em horas — nada de dias.
    [1500, "25:00"],
    [TETO_DE_MINUTOS, "744:00"],
  ])("%i vira %s", (minutos, texto) => {
    expect(formatarMinutos(minutos)).toBe(texto);
  });

  // Dado corrompido tem de APARECER. `-5` virando "0:00" seria o zero
  // silencioso do módulo reaparecendo na leitura; `NaN` virando "NaN:NaN",
  // lixo que parece defeito de render.
  test.each([-5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "%p não vira zero nem lixo",
    (minutos) => {
      expect(formatarMinutos(minutos)).toBe(DURACAO_INVALIDA);
    },
  );
});

// A 7.3 formata o valor gravado para dentro do campo e reinterpreta o que a
// pessoa deixar lá. Se as duas pontas divergirem, abrir e fechar o modal sem
// tocar em nada altera o lançamento — este teste é o que impede isso.
describe("ida e volta entre formatar e interpretar", () => {
  test.each([1, 5, 59, 60, 65, 115, 1500, TETO_DE_MINUTOS])(
    "%i sobrevive a formatar e reinterpretar",
    (minutos) => {
      expect(interpretarDuracao(formatarMinutos(minutos))).toEqual({
        tipo: "ok",
        minutos,
      });
    },
  );
});

describe("somarMinutos", () => {
  test("soma os lançamentos", () => {
    expect(somarMinutos([115, 60])).toBe(175);
  });

  test("um lançamento só é ele mesmo", () => {
    expect(somarMinutos([115])).toBe(115);
  });

  // Aqui o zero é legítimo: é a ausência de lançamentos, não uma entrada
  // inválida disfarçada.
  test("sem lançamentos, o total é 0", () => {
    expect(somarMinutos([])).toBe(0);
  });
});
