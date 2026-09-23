import { describe, expect, test } from "vitest";

import { TETO_DE_MINUTOS, formatarMinutos } from "@/src/lib/duracao";
import {
  estadoDerivadoDoItem,
  formatarDataHoraDigitada,
  lancamentosDoItem,
  lerServicos,
  linhaDeServicoDaCaixa,
  minutosAcumuladosDeServico,
  minutosDaLinhaDeServico,
  resumoDaEmissao,
  validarLancamentoDaCaixa,
  validarServicos,
  type LinhaServicoBruta,
  type LinhaServicoDerivavel,
} from "@/src/server/actions/emissao-estado";

// Story 7.3 — a camada de validação é onde a recusa da NFR7 nasce: é ela que
// decide se um lançamento vira linha gravável ou erro no campo daquela linha.
// Puro como o módulo de duração (nenhum banco, nenhum render), então a matriz
// inteira roda em milissegundos.
//
// O que estes testes prendem, e que nada mais prende: que uma entrada inválida
// NÃO vira zero (o mockup devolve `0` em cada um destes casos) e que ela
// aponta o CAMPO culpado — sem isso a mensagem aparece solta no topo do modal,
// sem dono.

const PESSOA = "pessoa-1";
const ITEM = "item-1";

function linha(overrides: Partial<LinhaServicoBruta> = {}): LinhaServicoBruta {
  return {
    indice: 0,
    pessoaId: PESSOA,
    itemRevisionalId: ITEM,
    modo: "Duracao",
    horas: "",
    inicio: "",
    fim: "",
    ...overrides,
  };
}

function campos(erros: { field: string }[]) {
  return erros.map((erro) => erro.field);
}

// O contrato de NOMES do FormData entre o componente (modal-emissao.tsx, que
// monta `servico-${indice}-...`) e o servidor (lerServicos, que lê os mesmos
// nomes). TypeScript não pega uma divergência — os dois lados são template
// strings —, e renomear só um deixaria toda linha "apenas horas" chegar vazia
// e ser descartada como linha fantasma, com a suíte inteira verde.
//
// Por isso os nomes abaixo são escritos LITERALMENTE, como o componente os
// renderiza: nenhuma constante compartilhada que mudasse nos dois lados junto.
describe("lerServicos: contrato de nomes do FormData", () => {
  test("lê as linhas pelos mesmos nomes que o componente renderiza", () => {
    const formData = new FormData();
    formData.set("servicoCount", "3");

    // Linha 0: "apenas horas" — o componente só renderiza o campo -horas.
    formData.set("servico-0-itemRevisionalId", ITEM);
    formData.set("servico-0-pessoaId", PESSOA);
    formData.set("servico-0-modo", "Duracao");
    formData.set("servico-0-horas", "1:55");

    // Linha 1: período — o componente renderiza -inicio e -fim no lugar.
    formData.set("servico-1-itemRevisionalId", ITEM);
    formData.set("servico-1-pessoaId", PESSOA);
    formData.set("servico-1-modo", "Periodo");
    formData.set("servico-1-inicio", "2026-01-15T08:00");
    formData.set("servico-1-fim", "2026-01-15T09:00");

    // Linha 2: recém-adicionada e intocada. O <select> de modo SEMPRE manda um
    // valor, e mesmo assim a linha tem de sumir — `modo` fica fora da checagem
    // de linha fantasma exatamente por isso.
    formData.set("servico-2-itemRevisionalId", "");
    formData.set("servico-2-pessoaId", "");
    formData.set("servico-2-modo", "Duracao");
    formData.set("servico-2-horas", "");

    const leitura = lerServicos(formData);
    expect(leitura.ok).toBe(true);
    const linhas = (leitura as { ok: true; linhas: LinhaServicoBruta[] }).linhas;

    expect(linhas).toEqual([
      {
        indice: 0,
        pessoaId: PESSOA,
        itemRevisionalId: ITEM,
        modo: "Duracao",
        horas: "1:55",
        inicio: "",
        fim: "",
      },
      {
        indice: 1,
        pessoaId: PESSOA,
        itemRevisionalId: ITEM,
        modo: "Periodo",
        horas: "",
        inicio: "2026-01-15T08:00",
        fim: "2026-01-15T09:00",
      },
    ]);

    // E as linhas lidas atravessam a validação como lançamentos de verdade —
    // um nome errado faria a de horas cair em "formato inválido" aqui.
    const { erros, servicos } = validarServicos(linhas);
    expect(erros).toEqual([]);
    expect(servicos).toHaveLength(2);
  });

  test("sem servicoCount não há linha nenhuma", () => {
    expect(lerServicos(new FormData())).toEqual({ ok: true, linhas: [] });
  });
});

describe("validarServicos: modo Duracao", () => {
  test("texto válido vira minutos e modo Duracao — sem datas", () => {
    const { erros, servicos } = validarServicos([linha({ horas: "1:55" })]);

    expect(erros).toEqual([]);
    expect(servicos).toEqual([
      { pessoaId: PESSOA, itemRevisionalId: ITEM, modo: "Duracao", duracaoMinutos: 115 },
    ]);
    // A união discriminada não tem marcos no ramo Duracao — se um dia tiver, a
    // CHECK do banco recusa a linha inteira.
    expect(servicos[0]).not.toHaveProperty("inicio");
  });

  // O ponto da story: cada motivo de recusa vira erro NO CAMPO, nunca 0.
  test.each([
    ["abc", "formato"],
    ["1:70", "formato"],
    ["", "vazio"],
  ])("texto inválido (%s: %s) recusa o salvamento", (horas) => {
    const { erros, servicos } = validarServicos([linha({ horas })]);

    expect(servicos).toEqual([]);
    expect(campos(erros)).toEqual(["servico-0-horas"]);
  });

  test.each(["0", "0:00"])("duração nula (%s) recusa o salvamento", (horas) => {
    const { erros, servicos } = validarServicos([linha({ horas })]);

    expect(servicos).toEqual([]);
    expect(campos(erros)).toEqual(["servico-0-horas"]);
    expect(erros[0].message).toMatch(/maiores que zero/);
  });

  test("acima do teto recusa, e a mensagem cita o teto do módulo", () => {
    const { erros, servicos } = validarServicos([linha({ horas: "745h" })]);

    expect(servicos).toEqual([]);
    expect(campos(erros)).toEqual(["servico-0-horas"]);
    // Sem "744" literal: se TETO_DE_MINUTOS mudar, a mensagem acompanha.
    expect(erros[0].message).toContain(formatarMinutos(TETO_DE_MINUTOS));
  });

  test("o teto exato ainda é aceito", () => {
    const { erros, servicos } = validarServicos([
      linha({ horas: `${TETO_DE_MINUTOS / 60}:00` }),
    ]);

    expect(erros).toEqual([]);
    expect(servicos[0]).toMatchObject({ modo: "Duracao", duracaoMinutos: TETO_DE_MINUTOS });
  });

  test("as três recusas de horas têm mensagens DISTINTAS", () => {
    const mensagens = ["abc", "0", "745h"].map(
      (horas) => validarServicos([linha({ horas })]).erros[0].message,
    );
    expect(new Set(mensagens).size).toBe(3);
  });
});

describe("validarServicos: modo Periodo", () => {
  test("período válido grava os marcos, sem duração", () => {
    const { erros, servicos } = validarServicos([
      linha({ modo: "Periodo", inicio: "2026-01-15T08:00", fim: "2026-01-15T09:55" }),
    ]);

    expect(erros).toEqual([]);
    expect(servicos[0]).toMatchObject({ modo: "Periodo" });
    expect(servicos[0]).not.toHaveProperty("duracaoMinutos");
  });

  test("período invertido recusa no campo do fim", () => {
    const { erros, servicos } = validarServicos([
      linha({ modo: "Periodo", inicio: "2026-01-15T10:00", fim: "2026-01-15T08:00" }),
    ]);

    expect(servicos).toEqual([]);
    expect(campos(erros)).toEqual(["servico-0-fim"]);
    expect(erros[0].message).toMatch(/anterior ao início/);
  });

  // Zero não é lançamento (NFR7/AD-30) — nem quando os dois marcos são válidos.
  test("período de duração nula recusa", () => {
    const { erros, servicos } = validarServicos([
      linha({ modo: "Periodo", inicio: "2026-01-15T08:00", fim: "2026-01-15T08:00" }),
    ]);

    expect(servicos).toEqual([]);
    expect(campos(erros)).toEqual(["servico-0-fim"]);
    expect(erros[0].message).toMatch(/depois do início/);
  });

  test("período acima do teto (32 dias) recusa", () => {
    const { erros, servicos } = validarServicos([
      linha({ modo: "Periodo", inicio: "2026-01-01T00:00", fim: "2026-02-02T00:00" }),
    ]);

    expect(servicos).toEqual([]);
    expect(campos(erros)).toEqual(["servico-0-fim"]);
    expect(erros[0].message).toContain(formatarMinutos(TETO_DE_MINUTOS));
  });

  test("período incompleto (só o início) recusa no campo do fim", () => {
    const { erros, servicos } = validarServicos([
      linha({ modo: "Periodo", inicio: "2026-01-15T08:00" }),
    ]);

    expect(servicos).toEqual([]);
    expect(campos(erros)).toEqual(["servico-0-fim"]);
  });

  test("marco malformado recusa no próprio campo", () => {
    const { erros, servicos } = validarServicos([
      linha({ modo: "Periodo", inicio: "2026-02-30T08:00", fim: "2026-01-15T09:00" }),
    ]);

    expect(servicos).toEqual([]);
    expect(campos(erros)).toContain("servico-0-inicio");
  });
});

describe("validarServicos: a linha inteira", () => {
  test("modo adulterado é recusado e nunca chega ao repositório", () => {
    const { erros, servicos } = validarServicos([linha({ modo: "Qualquer", horas: "1:55" })]);

    expect(servicos).toEqual([]);
    expect(campos(erros)).toEqual(["servico-0-modo"]);
  });

  test("pessoa e item continuam obrigatórios", () => {
    const { erros, servicos } = validarServicos([
      linha({ pessoaId: "", itemRevisionalId: "", horas: "1:55" }),
    ]);

    expect(servicos).toEqual([]);
    expect(campos(erros)).toEqual(["servico-0-pessoaId", "servico-0-itemRevisionalId"]);
  });

  // AC: "Given uma linha inválida entre linhas válidas ... nada é gravado e o
  // erro aponta a linha e o campo culpados". A linha boa NÃO pode ser salva
  // sozinha — quem garante isso é a Server Action, que aborta com `erros` não
  // vazio; aqui garantimos que o erro existe e que traz o índice certo.
  test("uma linha inválida no meio de linhas válidas aponta a linha culpada", () => {
    const { erros, servicos } = validarServicos([
      linha({ indice: 0, horas: "1:00" }),
      linha({ indice: 1, horas: "1:70" }),
      linha({ indice: 2, modo: "Periodo", inicio: "2026-01-15T08:00", fim: "2026-01-15T09:00" }),
    ]);

    expect(campos(erros)).toEqual(["servico-1-horas"]);
    // As linhas boas foram interpretadas, mas a Server Action não grava nada
    // enquanto `erros` não estiver vazio.
    expect(servicos).toHaveLength(2);
  });

  test("zero linhas continua estado válido", () => {
    expect(validarServicos([])).toEqual({ erros: [], servicos: [] });
  });
});

// AC: "cada linha conserva seu modo e seus minutos — nenhuma vira a outra".
// A ida e volta completa é: minutos gravados -> formatarMinutos (o que a tela
// devolve ao input ao reabrir) -> validarServicos -> os MESMOS minutos.
describe("ida e volta da edição", () => {
  test.each([1, 59, 115, 600, TETO_DE_MINUTOS])(
    "%i minutos sobrevivem a reabrir e salvar",
    (minutos) => {
      const { erros, servicos } = validarServicos([
        linha({ horas: formatarMinutos(minutos) }),
      ]);

      expect(erros).toEqual([]);
      expect(servicos[0]).toMatchObject({ modo: "Duracao", duracaoMinutos: minutos });
    },
  );

  test("uma linha Periodo reaberta continua Periodo", () => {
    const { servicos } = validarServicos([
      linha({ modo: "Periodo", inicio: "2026-01-15T08:00", fim: "2026-01-15T09:55" }),
    ]);
    expect(servicos[0].modo).toBe("Periodo");
  });
});

// I/O Matrix "Total ao vivo" e "Sem lançamentos". É o total que a aba Serviço
// mostra a cada tecla, ANTES de qualquer submit — e o ponto é o tratamento do
// inválido: o mockup exibiria "0:00" em cada um dos casos recusados abaixo, o
// que somaria zero ao acumulado sem ninguém perceber (NFR7/AD-30).
//
// A célula não é renderizada em teste (o projeto não tem render de componente),
// mas o que ela exibe é decidido inteiramente aqui: `ok` vira formatarMinutos,
// recusado vira DURACAO_INVALIDA.
describe("total derivado da tela", () => {
  function derivavel(overrides: Partial<LinhaServicoDerivavel> = {}): LinhaServicoDerivavel {
    return { modo: "Duracao", horas: "", inicio: "", fim: "", ...overrides };
  }

  test("linha por horas rende os minutos do texto", () => {
    expect(minutosDaLinhaDeServico(derivavel({ horas: "1:55" }))).toEqual({
      tipo: "ok",
      minutos: 115,
    });
  });

  test("linha por período rende os minutos entre os marcos", () => {
    const resultado = minutosDaLinhaDeServico(
      derivavel({ modo: "Periodo", inicio: "2026-01-15T08:00", fim: "2026-01-15T09:55" }),
    );
    expect(resultado).toEqual({ tipo: "ok", minutos: 115 });
  });

  // O coração da matriz: nenhum destes vale zero.
  test.each([
    ["texto sem sentido", derivavel({ horas: "abc" })],
    ["texto vazio", derivavel({ horas: "" })],
    ["minutos fora de faixa", derivavel({ horas: "1:70" })],
    ["duração nula", derivavel({ horas: "0:00" })],
    ["acima do teto", derivavel({ horas: "745h" })],
    ["período só com o início", derivavel({ modo: "Periodo", inicio: "2026-01-15T08:00" })],
    ["período vazio", derivavel({ modo: "Periodo" })],
    [
      "período invertido",
      derivavel({ modo: "Periodo", inicio: "2026-01-15T10:00", fim: "2026-01-15T08:00" }),
    ],
    [
      "período de duração nula",
      derivavel({ modo: "Periodo", inicio: "2026-01-15T08:00", fim: "2026-01-15T08:00" }),
    ],
  ])("%s é recusado, nunca zero", (_rotulo, linhaDerivavel) => {
    const resultado = minutosDaLinhaDeServico(linhaDerivavel);

    expect(resultado.tipo).toBe("recusado");
    // A distinção que a story existe para manter: recusado NÃO é `{ok, 0}`.
    expect(resultado).not.toEqual({ tipo: "ok", minutos: 0 });
  });

  // "Troca de modo na tela": a MESMA linha, só mudando o modo, muda de total —
  // é o que faz a coluna Fim deixar de ser travessão e o total recalcular.
  test("trocar o modo da mesma linha troca o total", () => {
    const comum = { horas: "1:00", inicio: "2026-01-15T08:00", fim: "2026-01-15T10:00" };

    expect(minutosDaLinhaDeServico(derivavel({ ...comum, modo: "Duracao" }))).toEqual({
      tipo: "ok",
      minutos: 60,
    });
    expect(minutosDaLinhaDeServico(derivavel({ ...comum, modo: "Periodo" }))).toEqual({
      tipo: "ok",
      minutos: 120,
    });
  });

  test("o acumulado soma os dois modos", () => {
    const total = minutosAcumuladosDeServico([
      derivavel({ horas: "1:55" }),
      derivavel({ modo: "Periodo", inicio: "2026-01-15T08:00", fim: "2026-01-15T09:00" }),
    ]);
    expect(total).toBe(175);
  });

  // Uma linha recusada não empurra o acumulado para baixo nem para cima: ela
  // fica FORA da soma. Se virasse 0, o total continuaria "certo" por acidente
  // aqui — mas mentiria na célula dela, que é onde o erro é percebido.
  test("linha recusada não entra no acumulado", () => {
    const total = minutosAcumuladosDeServico([
      derivavel({ horas: "1:55" }),
      derivavel({ horas: "abc" }),
    ]);
    expect(total).toBe(115);
  });

  // "Sem lançamentos": o rodapé mostra "0:00" e esse é o zero honesto.
  test("sem lançamentos o acumulado é zero", () => {
    expect(minutosAcumuladosDeServico([])).toBe(0);
    expect(formatarMinutos(minutosAcumuladosDeServico([]))).toBe("0:00");
  });
});

// ---------------------------------------------------------------------------
// Story 7.4 — estado DERIVADO do item (AD-31)
// ---------------------------------------------------------------------------
// O que estes testes prendem, e que nada mais prende: que o estado é COMPUTADO
// de `executado` + lançamentos na leitura (nunca lido de coluna), que
// "executado" tem PRECEDÊNCIA sobre a ausência de lançamento, e que o
// casamento item↔lançamento é por `itemRevisionalId` — o mockup casa por NOME
// (L2384), e dois itens homônimos misturariam lançamentos.
describe("estado derivado do item", () => {
  const OUTRO_ITEM = "item-2";

  test("intocado: não executado e sem lançamento é Pendente", () => {
    expect(
      estadoDerivadoDoItem({ itemRevisionalId: ITEM, executado: false, lancamentos: [] }),
    ).toBe("pendente");
  });

  test("com serviço: não executado e com lançamento é Serviço apontado", () => {
    expect(
      estadoDerivadoDoItem({
        itemRevisionalId: ITEM,
        executado: false,
        lancamentos: [{ itemRevisionalId: ITEM }],
      }),
    ).toBe("parcial");
  });

  test("executado com lançamento é Concluído", () => {
    expect(
      estadoDerivadoDoItem({
        itemRevisionalId: ITEM,
        executado: true,
        lancamentos: [{ itemRevisionalId: ITEM }],
      }),
    ).toBe("concluido");
  });

  // Precedência, não soma: quem marcou declarou que terminou.
  test("executado SEM nenhum lançamento é Concluído, nunca Pendente", () => {
    expect(
      estadoDerivadoDoItem({ itemRevisionalId: ITEM, executado: true, lancamentos: [] }),
    ).toBe("concluido");
  });

  // O ponto: lançamento de OUTRO item não pinta esta linha.
  test("lançamento de outro item não tira esta linha de Pendente", () => {
    expect(
      estadoDerivadoDoItem({
        itemRevisionalId: ITEM,
        executado: false,
        lancamentos: [{ itemRevisionalId: OUTRO_ITEM }],
      }),
    ).toBe("pendente");
  });

  test("a caixa só enxerga os lançamentos do próprio itemRevisionalId", () => {
    const lancamentos = [
      { itemRevisionalId: ITEM, chave: 1 },
      { itemRevisionalId: OUTRO_ITEM, chave: 2 },
      { itemRevisionalId: ITEM, chave: 3 },
    ];
    expect(lancamentosDoItem(lancamentos, ITEM).map((l) => l.chave)).toEqual([1, 3]);
    expect(lancamentosDoItem(lancamentos, OUTRO_ITEM).map((l) => l.chave)).toEqual([2]);
  });

  // Reabrir a emissão recomputa: o MESMO item vira outro estado só porque um
  // lançamento existe — nada de estado lido de coluna.
  test("remover o último lançamento devolve o item a Pendente", () => {
    const antes = estadoDerivadoDoItem({
      itemRevisionalId: ITEM,
      executado: false,
      lancamentos: [{ itemRevisionalId: ITEM }],
    });
    const depois = estadoDerivadoDoItem({
      itemRevisionalId: ITEM,
      executado: false,
      lancamentos: [],
    });
    expect([antes, depois]).toEqual(["parcial", "pendente"]);
  });
});

// ---------------------------------------------------------------------------
// Story 7.4 — recusa da caixa embutida na linha (NFR7/AD-30, UX-DR17)
// ---------------------------------------------------------------------------
// O mockup (`confirmarServicoItem`, L2410) valida só marcos e ordem, por
// alert(), e aceita período sem pessoa e acima do teto. Cada teste abaixo é um
// ponto em que esta implementação diverge — e nenhuma recusa vira zero.
describe("validarLancamentoDaCaixa", () => {
  const BASE = { pessoaId: PESSOA, inicio: "2026-01-15T08:00", fim: "2026-01-15T09:55" };

  test("pessoa + período válido rende os minutos do período", () => {
    expect(validarLancamentoDaCaixa(BASE)).toEqual({ tipo: "ok", minutos: 115 });
  });

  test.each([
    ["sem início", { ...BASE, inicio: "" }],
    ["sem fim", { ...BASE, fim: "" }],
    ["sem nenhum marco", { ...BASE, inicio: "", fim: "" }],
  ])("%s é recusado com mensagem", (_rotulo, entrada) => {
    const resultado = validarLancamentoDaCaixa(entrada);
    expect(resultado.tipo).toBe("recusado");
    expect(resultado).toMatchObject({ mensagem: expect.stringMatching(/início e o fim/) });
  });

  test("período invertido é recusado", () => {
    const resultado = validarLancamentoDaCaixa({
      ...BASE,
      inicio: "2026-01-15T10:00",
      fim: "2026-01-15T08:00",
    });
    expect(resultado.tipo).toBe("recusado");
    expect(resultado).toMatchObject({ mensagem: expect.stringMatching(/anterior ao início/) });
  });

  // Zero não é lançamento (NFR7) — o mockup recusa este caso, mas com alert().
  test("fim igual ao início é recusado, nunca vira 0:00", () => {
    const resultado = validarLancamentoDaCaixa({ ...BASE, fim: BASE.inicio });
    expect(resultado.tipo).toBe("recusado");
    expect(resultado).not.toEqual({ tipo: "ok", minutos: 0 });
  });

  // Divergência do mockup: ele não tem teto nenhum nesta caixa.
  test("período acima do teto é recusado, citando o teto do módulo", () => {
    const resultado = validarLancamentoDaCaixa({
      ...BASE,
      inicio: "2026-01-01T00:00",
      fim: "2026-02-02T00:00",
    });
    expect(resultado.tipo).toBe("recusado");
    expect(resultado).toMatchObject({
      mensagem: expect.stringContaining(formatarMinutos(TETO_DE_MINUTOS)),
    });
  });

  test("o teto exato ainda é aceito", () => {
    expect(
      validarLancamentoDaCaixa({ ...BASE, inicio: "2026-01-01T00:00", fim: "2026-02-01T00:00" }),
    ).toEqual({ tipo: "ok", minutos: TETO_DE_MINUTOS });
  });

  // Divergência do mockup: ele nunca checa a pessoa (o <select> dele não tem
  // opção vazia). Aqui ela é obrigatória, e a recusa acontece ANTES de olhar os
  // marcos — a mensagem aponta o que de fato falta.
  test("sem pessoa é recusado mesmo com período válido", () => {
    const resultado = validarLancamentoDaCaixa({ ...BASE, pessoaId: "" });
    expect(resultado.tipo).toBe("recusado");
    expect(resultado).toMatchObject({ mensagem: expect.stringMatching(/pessoa/i) });
  });

  // O lançamento que a caixa aceita é o mesmo que o submit aceita: divergir
  // faria a caixa prometer um lançamento que a Server Action recusa depois.
  test("o que a caixa aceita atravessa validarServicos como modo Periodo", () => {
    expect(validarLancamentoDaCaixa(BASE).tipo).toBe("ok");
    const { erros, servicos } = validarServicos([
      linha({ modo: "Periodo", inicio: BASE.inicio, fim: BASE.fim }),
    ]);
    expect(erros).toEqual([]);
    expect(servicos[0]).toMatchObject({ modo: "Periodo", itemRevisionalId: ITEM });
  });
});

// ---------------------------------------------------------------------------
// Story 7.4 — a linha de serviço MONTADA a partir da caixa (UX-DR17)
// ---------------------------------------------------------------------------
// Enquanto esta montagem vivia dentro do .tsx, trocar `modo` para "Duracao" ou
// passar o item errado deixava a suíte inteira verde — exatamente o que estes
// testes existem para impedir.
describe("linhaDeServicoDaCaixa", () => {
  const ENTRADA = { pessoaId: PESSOA, inicio: "2026-01-15T08:00", fim: "2026-01-15T09:55" };

  test("carrega o item da linha, o modo Periodo, horas vazias e os marcos digitados", () => {
    expect(linhaDeServicoDaCaixa(ITEM, ENTRADA)).toEqual({
      pessoaId: PESSOA,
      itemRevisionalId: ITEM,
      modo: "Periodo",
      horas: "",
      inicio: "2026-01-15T08:00",
      fim: "2026-01-15T09:55",
    });
  });

  test("o item vem do argumento, nunca do lançamento", () => {
    expect(linhaDeServicoDaCaixa("outro-item", ENTRADA).itemRevisionalId).toBe("outro-item");
  });

  // A linha montada aqui é a mesma que o submit envia: se ela não atravessasse
  // validarServicos, a caixa aceitaria um lançamento que a Server Action recusa.
  test("atravessa validarServicos como lançamento válido", () => {
    const montada = linhaDeServicoDaCaixa(ITEM, ENTRADA);
    const { erros, servicos } = validarServicos([{ indice: 0, ...montada }]);
    expect(erros).toEqual([]);
    expect(servicos).toEqual([
      {
        pessoaId: PESSOA,
        itemRevisionalId: ITEM,
        modo: "Periodo",
        inicio: new Date(Date.UTC(2026, 0, 15, 8, 0)),
        fim: new Date(Date.UTC(2026, 0, 15, 9, 55)),
      },
    ]);
  });

  // Derivação e submit veem a mesma linha: o total exibido na caixa é o mesmo
  // que o servidor vai gravar.
  test("a linha montada rende os minutos do período na derivação", () => {
    expect(minutosDaLinhaDeServico(linhaDeServicoDaCaixa(ITEM, ENTRADA))).toEqual({
      tipo: "ok",
      minutos: 115,
    });
  });
});

// ---------------------------------------------------------------------------
// Story 7.4 (parte 2) — a faixa de resumo da aba Geral (UX-DR18/AD-29)
// ---------------------------------------------------------------------------
// O que estes testes prendem, e que nada mais prende: que o denominador é o
// total de itens DESTA emissão (o mockup usa `ITENS_CATALOG.length`, L2263),
// que a emissão vazia nunca divide por zero, que o percentual é inteiro, e a
// assimetria do Design Notes — a linha recusada CONTA em "Lançamentos" e NÃO
// soma em "Horas".
describe("resumoDaEmissao", () => {
  function item(executado: boolean) {
    return { executado };
  }
  function derivavel(overrides: Partial<LinhaServicoDerivavel> = {}): LinhaServicoDerivavel {
    return { modo: "Duracao", horas: "", inicio: "", fim: "", ...overrides };
  }

  test("emissão em andamento: os cinco valores da matriz", () => {
    const resumo = resumoDaEmissao({
      itens: [true, true, true, false, false, false, false, false].map(item),
      lancamentos: [
        derivavel({ horas: "1:55" }),
        derivavel({ modo: "Periodo", inicio: "2026-01-15T08:00", fim: "2026-01-15T09:00" }),
      ],
    });

    expect(resumo).toEqual({
      minutosAcumulados: 175,
      lancamentosDeServico: 2,
      itensExecutados: 3,
      totalDeItens: 8,
      itensPendentes: 5,
      percentualExecutado: 38,
    });
  });

  // Divisão por zero: sem o guarda, `0/0` é NaN e o cartão exibe "NaN%".
  test("emissão vazia: zeros honestos, nunca NaN", () => {
    expect(resumoDaEmissao({ itens: [], lancamentos: [] })).toEqual({
      minutosAcumulados: 0,
      lancamentosDeServico: 0,
      itensExecutados: 0,
      totalDeItens: 0,
      itensPendentes: 0,
      percentualExecutado: 0,
    });
  });

  test("tudo executado fecha em 100% e zero pendentes", () => {
    const resumo = resumoDaEmissao({ itens: [true, true, true, true].map(item), lancamentos: [] });
    expect(resumo.itensExecutados).toBe(4);
    expect(resumo.totalDeItens).toBe(4);
    expect(resumo.itensPendentes).toBe(0);
    expect(resumo.percentualExecutado).toBe(100);
  });

  test("nada executado fica em 0% com todos pendentes", () => {
    const resumo = resumoDaEmissao({
      itens: [false, false, false, false, false].map(item),
      lancamentos: [],
    });
    expect(resumo.itensExecutados).toBe(0);
    expect(resumo.totalDeItens).toBe(5);
    expect(resumo.itensPendentes).toBe(5);
    expect(resumo.percentualExecutado).toBe(0);
  });

  // Inteiro, nunca fração: 1/3 = 33.333… precisa virar 33, não 33.33333.
  test("o percentual é arredondado para inteiro", () => {
    const resumo = resumoDaEmissao({ itens: [true, false, false].map(item), lancamentos: [] });
    expect(resumo.percentualExecutado).toBe(33);
    expect(Number.isInteger(resumo.percentualExecutado)).toBe(true);
  });

  // Prende o arredondamento nos DOIS sentidos: com só 1/3 → 33 acima,
  // `Math.floor` passaria igual. 2/3 = 66.67 só vira 67 arredondando para cima.
  test("o percentual arredonda para cima quando a fração passa da metade", () => {
    const resumo = resumoDaEmissao({ itens: [true, true, false].map(item), lancamentos: [] });
    expect(resumo.percentualExecutado).toBe(67);
  });

  // NFR7 — os dois extremos onde o arredondamento MENTIRIA: "100%" com um item
  // ainda pendente ao lado, e "0%" com um item já feito.
  test("quase tudo executado não vira 100% enquanto sobrar pendente", () => {
    const itens = Array.from({ length: 200 }, (_, indice) => item(indice > 0));
    const resumo = resumoDaEmissao({ itens, lancamentos: [] });
    expect(resumo.itensPendentes).toBe(1);
    expect(resumo.percentualExecutado).toBe(99);
  });

  test("um único item executado não vira 0%", () => {
    const itens = Array.from({ length: 500 }, (_, indice) => item(indice === 0));
    const resumo = resumoDaEmissao({ itens, lancamentos: [] });
    expect(resumo.itensExecutados).toBe(1);
    expect(resumo.percentualExecutado).toBe(1);
  });

  // O denominador é o total de ITENS DESTA emissão — nunca um catálogo global
  // nem o número de lançamentos: as duas contagens são independentes.
  test("o denominador segue os itens da emissão, não os lançamentos", () => {
    const resumo = resumoDaEmissao({
      itens: [true, false].map(item),
      lancamentos: [derivavel({ horas: "1:00" }), derivavel({ horas: "1:00" })],
    });
    // Dois lançamentos, mas o denominador continua sendo os dois ITENS — e o
    // numerador, o único marcado.
    expect(resumo.itensExecutados).toBe(1);
    expect(resumo.totalDeItens).toBe(2);
    expect(resumo.percentualExecutado).toBe(50);
    expect(resumo.lancamentosDeServico).toBe(2);
  });

  // Design Notes: a assimetria proposital. Duas perguntas diferentes — quantas
  // entradas existem na tela, e quanto tempo elas somam.
  test("linha recusada conta em Lançamentos mas não soma em Horas", () => {
    const resumo = resumoDaEmissao({
      itens: [],
      lancamentos: [derivavel({ horas: "1:55" }), derivavel({ horas: "abc" })],
    });

    expect(resumo.lancamentosDeServico).toBe(2);
    expect(resumo.minutosAcumulados).toBe(115);
  });

  // Mudança ao vivo: os mesmos itens, só uma marcação a mais, mudam os cinco —
  // é a derivação que responde, nunca um valor gravado.
  test("marcar um item a mais muda os indicadores sem nenhum submit", () => {
    const antes = resumoDaEmissao({ itens: [false, false].map(item), lancamentos: [] });
    const depois = resumoDaEmissao({ itens: [true, false].map(item), lancamentos: [] });

    expect([antes.percentualExecutado, depois.percentualExecutado]).toEqual([0, 50]);
    expect([antes.itensPendentes, depois.itensPendentes]).toEqual([2, 1]);
  });

  // As horas da faixa são as MESMAS do rodapé da aba Serviço — divergir faria
  // dois números da mesma tela discordarem. Em MINUTOS: a formatação é do JSX.
  test("as horas da faixa são o acumulado da aba Serviço", () => {
    const lancamentos = [derivavel({ horas: "1:55" }), derivavel({ horas: "abc" })];
    expect(resumoDaEmissao({ itens: [], lancamentos }).minutosAcumulados).toBe(
      minutosAcumuladosDeServico(lancamentos),
    );
  });
});

describe("formatarDataHoraDigitada", () => {
  test("formata o valor completo do input em dd/mm/aaaa hh:mm", () => {
    expect(formatarDataHoraDigitada("2026-01-15T08:30")).toBe("15/01/2026 08:30");
  });

  test("aceita o valor com segundos, descartando-os", () => {
    expect(formatarDataHoraDigitada("2026-01-15T08:30:45")).toBe("15/01/2026 08:30");
  });

  test("vazio vira travessão", () => {
    expect(formatarDataHoraDigitada("")).toBe("—");
    expect(formatarDataHoraDigitada("   ")).toBe("—");
  });

  // O bug que isto prende: validar só a presença do "T" fazia uma data
  // incompleta renderizar "undefined/undefined/2026 08:30" na tela.
  test.each(["2026-01T08:30", "2026T08:30", "15/01/2026", "2026-01-15", "2026-01-15T8:30"])(
    "valor malformado (%s) volta cru, nunca com 'undefined'",
    (valor) => {
      const saida = formatarDataHoraDigitada(valor);
      expect(saida).toBe(valor);
      expect(saida).not.toContain("undefined");
    },
  );
});
