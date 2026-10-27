import { beforeEach, describe, expect, test } from "vitest";

import {
  CATEGORIA_SEM_NOME,
  GRUPO_SEM_NOME,
  minutosDoServicoGravado,
  rotuloDoGrupo,
  secoesDaOS,
  totalDeMinutosGravados,
  type ItemDaOS,
} from "@/src/lib/ordem-de-servico";
import { buscarEmissaoParaImpressao } from "@/src/server/repositories/emissao";

import {
  criarEmissaoCompleta,
  criarEmpresa,
  criarItemRevisional,
  db,
  limparBanco,
} from "./setup/fixtures";

beforeEach(limparBanco);

// C2 — a Ordem de Serviço impressa. O que estes testes prendem é a
// ORGANIZAÇÃO do papel (seções, ordem, quais colunas saem) e a apuração da
// duração a partir do dado JÁ GRAVADO. É a única camada testável da OS: o
// projeto não tem render de componente, então a página em si fica coberta
// apenas pela compilação.

function item(parcial: Partial<ItemDaOS> & { nome: string }): ItemDaOS {
  return {
    itemRevisionalId: parcial.nome,
    categoria: null,
    grupo: null,
    etapa1: null,
    etapa2: null,
    etapa3: null,
    executado: false,
    observacao: null,
    ...parcial,
  };
}

describe("secoesDaOS", () => {
  test("agrupa por categoria em ordem pt-BR, com 'Sem categoria' por último", () => {
    // Duas armadilhas de propósito neste cenário:
    //  - "Ôleo" antes de "Pneus" distingue a comparação por acento da
    //    comparação por code point, onde "Ô" (U+00D4) viria DEPOIS de "P";
    //  - "Transmissão" vem DEPOIS de "Sem categoria" no alfabeto. Sem ela, a
    //    regra "sem categoria por último" seria indistinguível da ordenação
    //    alfabética pura, e remover o caso especial passaria no teste.
    //    Verificado por mutação — era exatamente este o furo.
    const secoes = secoesDaOS([
      item({ nome: "Sem nada" }),
      item({ nome: "Calibragem", categoria: "Pneus" }),
      item({ nome: "Troca", categoria: "Ôleo" }),
      item({ nome: "Eixo", categoria: "Transmissão" }),
      item({ nome: "Faróis", categoria: "Elétrica" }),
    ]);

    expect(secoes.map((secao) => secao.categoria)).toEqual([
      "Elétrica",
      "Ôleo",
      "Pneus",
      "Transmissão",
      CATEGORIA_SEM_NOME,
    ]);
  });

  test("categoria em branco cai em 'Sem categoria' junto com a nula", () => {
    // String vazia e só-espaços vêm do formulário quando a pessoa apaga o
    // campo; tratá-las como categorias próprias abriria três seções onde
    // deve haver uma.
    const secoes = secoesDaOS([
      item({ nome: "A", categoria: null }),
      item({ nome: "B", categoria: "" }),
      item({ nome: "C", categoria: "   " }),
    ]);

    expect(secoes).toHaveLength(1);
    expect(secoes[0].categoria).toBe(CATEGORIA_SEM_NOME);
    expect(secoes[0].itens.map((linha) => linha.nome)).toEqual(["A", "B", "C"]);
  });

  test("nenhum item da emissão some do papel", () => {
    const entrada = [
      item({ nome: "A", categoria: "Mecânica" }),
      item({ nome: "B" }),
      item({ nome: "C", categoria: "Mecânica" }),
    ];

    const impressos = secoesDaOS(entrada).flatMap((secao) => secao.itens);

    expect(impressos).toHaveLength(entrada.length);
    expect(impressos.map((linha) => linha.nome).sort()).toEqual(["A", "B", "C"]);
  });

  test("dentro da seção ordena por grupo e depois por nome, com os sem grupo no fim", () => {
    const [secao] = secoesDaOS([
      item({ nome: "Zebra", categoria: "Mecânica", grupo: "Cabine" }),
      item({ nome: "Alavanca", categoria: "Mecânica" }),
      item({ nome: "Bomba", categoria: "Mecânica", grupo: "Motor" }),
      item({ nome: "Ajuste", categoria: "Mecânica", grupo: "Cabine" }),
    ]);

    // "Ajuste" antes de "Zebra" dentro de Cabine é o desempate por nome; sem
    // ele o teste passaria com uma ordenação que só olha o grupo.
    expect(secao.itens.map((linha) => linha.nome)).toEqual([
      "Ajuste",
      "Zebra",
      "Bomba",
      "Alavanca",
    ]);
  });

  test("a coluna de etapa só sai na seção em que ALGUM item a preenche", () => {
    // Duas seções com perfis DIFERENTES de propósito: com uma só, uma
    // implementação que decidisse as colunas olhando o relatório inteiro
    // daria o mesmo resultado e o defeito passaria.
    const secoes = secoesDaOS([
      item({ nome: "Faróis", categoria: "Elétrica", etapa1: "Correto funcionamento" }),
      item({ nome: "Bateria", categoria: "Elétrica", etapa3: "Lubrificar" }),
      item({ nome: "Bomba", categoria: "Mecânica" }),
    ]);

    const eletrica = secoes[0];
    expect(eletrica.categoria).toBe("Elétrica");
    expect(eletrica.etapasVisiveis).toEqual({ etapa1: true, etapa2: false, etapa3: true });
    expect(eletrica.quantidadeDeEtapas).toBe(2);

    const mecanica = secoes[1];
    expect(mecanica.etapasVisiveis).toEqual({ etapa1: false, etapa2: false, etapa3: false });
    expect(mecanica.quantidadeDeEtapas).toBe(0);
  });

  test("etapa só com espaços não abre coluna", () => {
    const [secao] = secoesDaOS([item({ nome: "Faróis", categoria: "Elétrica", etapa1: "   " })]);
    expect(secao.etapasVisiveis.etapa1).toBe(false);
  });

  test("emissão sem itens não gera seção nenhuma", () => {
    expect(secoesDaOS([])).toEqual([]);
  });
});

describe("rotuloDoGrupo", () => {
  test("devolve o grupo aparado, e o travessão quando não há", () => {
    expect(rotuloDoGrupo("  Motor  ")).toBe("Motor");
    expect(rotuloDoGrupo(null)).toBe(GRUPO_SEM_NOME);
    expect(rotuloDoGrupo("  ")).toBe(GRUPO_SEM_NOME);
  });
});

describe("minutosDoServicoGravado", () => {
  test("modo Duracao usa os minutos gravados", () => {
    expect(
      minutosDoServicoGravado({
        modo: "Duracao",
        duracaoMinutos: 115,
        inicio: null,
        fim: null,
      }),
    ).toBe(115);
  });

  test("modo Periodo subtrai os marcos", () => {
    expect(
      minutosDoServicoGravado({
        modo: "Periodo",
        duracaoMinutos: null,
        inicio: new Date(Date.UTC(2026, 9, 27, 8, 0)),
        fim: new Date(Date.UTC(2026, 9, 27, 9, 55)),
      }),
    ).toBe(115);
  });

  test("linha legada sem duração apurável vale null, nunca zero", () => {
    // `Periodo` com os dois marcos nulos é a linha da 5.5, gravada antes de a
    // CHECK apertar. Ela existe e o usuário a vê; somá-la como zero faria o
    // total do papel mentir (NFR7).
    expect(
      minutosDoServicoGravado({ modo: "Periodo", duracaoMinutos: null, inicio: null, fim: null }),
    ).toBeNull();
    expect(
      minutosDoServicoGravado({ modo: "Duracao", duracaoMinutos: null, inicio: null, fim: null }),
    ).toBeNull();
  });

  test("período invertido ou de duração nula vale null", () => {
    const inicio = new Date(Date.UTC(2026, 9, 27, 9, 0));
    expect(
      minutosDoServicoGravado({
        modo: "Periodo",
        duracaoMinutos: null,
        inicio,
        fim: new Date(Date.UTC(2026, 9, 27, 8, 0)),
      }),
    ).toBeNull();
    expect(
      minutosDoServicoGravado({ modo: "Periodo", duracaoMinutos: null, inicio, fim: inicio }),
    ).toBeNull();
  });
});

describe("totalDeMinutosGravados", () => {
  test("soma só as linhas apuráveis", () => {
    const total = totalDeMinutosGravados([
      { modo: "Duracao", duracaoMinutos: 60, inicio: null, fim: null },
      // A linha não apurável no MEIO da lista: se ela contribuísse com zero o
      // total seria o mesmo, então o que a prova é a soma das outras duas.
      { modo: "Periodo", duracaoMinutos: null, inicio: null, fim: null },
      {
        modo: "Periodo",
        duracaoMinutos: null,
        inicio: new Date(Date.UTC(2026, 9, 27, 8, 0)),
        fim: new Date(Date.UTC(2026, 9, 27, 8, 30)),
      },
    ]);

    expect(total).toBe(90);
  });

  test("sem lançamentos o total é zero — o único zero honesto do papel", () => {
    expect(totalDeMinutosGravados([])).toBe(0);
  });
});

describe("buscarEmissaoParaImpressao", () => {
  test("traz o que o papel precisa e que a listagem não carrega", async () => {
    const cenario = await criarEmissaoCompleta();
    const empresa = await criarEmpresa(cenario.conta.id, { razaoSocial: "Transportes Raiz" });
    await db.ativo.update({
      where: { id: cenario.ativo.id },
      data: { empresaId: empresa.id, numeroSerie: "SN-900" },
    });
    await db.itemRevisional.update({
      where: { id: cenario.item.id },
      data: {
        categoria: "Elétrica",
        grupo: "Cabine",
        etapa1: "Correto funcionamento",
        etapa3: "Lubrificar",
      },
    });
    await db.itemExecutadoEmissao.create({
      data: { emissaoId: cenario.emissao.id, itemRevisionalId: cenario.item.id, executado: true },
    });
    await db.servicoEmissao.create({
      data: {
        emissaoId: cenario.emissao.id,
        pessoaId: cenario.pessoa.id,
        itemRevisionalId: cenario.item.id,
        modo: "Duracao",
        duracaoMinutos: 90,
      },
    });

    const lida = await buscarEmissaoParaImpressao(cenario.conta.id, cenario.emissao.id);

    expect(lida).not.toBeNull();
    expect(lida?.ativo.empresa?.razaoSocial).toBe("Transportes Raiz");
    expect(lida?.ativo.numeroSerie).toBe("SN-900");
    expect(lida?.ativo.tipoAtivo.nome).toBe(cenario.tipoAtivo.nome);
    expect(lida?.conta.nome).toBe(cenario.conta.nome);
    expect(lida?.itens[0].itemRevisional.categoria).toBe("Elétrica");
    expect(lida?.itens[0].itemRevisional.grupo).toBe("Cabine");
    expect(lida?.itens[0].itemRevisional.etapa1).toBe("Correto funcionamento");
    expect(lida?.itens[0].itemRevisional.etapa3).toBe("Lubrificar");
    expect(lida?.servicos[0].pessoa.nome).toBe(cenario.pessoa.nome);
    expect(lida?.servicos[0].itemRevisional.nome).toBe(cenario.item.nome);
  });

  test("a emissão de OUTRA conta não é encontrada (AD-1)", async () => {
    const minha = await criarEmissaoCompleta();
    const outra = await criarEmissaoCompleta({ nomeDaConta: "Outra conta" });

    // O id EXISTE — o que o impede de ser lido é o escopo por contaId, não a
    // inexistência. Sem a emissão da outra conta no banco, um `where` sem
    // contaId passaria neste teste.
    expect(await buscarEmissaoParaImpressao(minha.conta.id, outra.emissao.id)).toBeNull();
    expect(await buscarEmissaoParaImpressao(minha.conta.id, minha.emissao.id)).not.toBeNull();
  });

  test("itens de um item revisional sem categoria chegam com os campos nulos", async () => {
    const cenario = await criarEmissaoCompleta();
    const avulso = await criarItemRevisional(cenario.conta.id, { nome: "Item sem organização" });
    await db.itemExecutadoEmissao.create({
      data: { emissaoId: cenario.emissao.id, itemRevisionalId: avulso.id, executado: false },
    });

    const lida = await buscarEmissaoParaImpressao(cenario.conta.id, cenario.emissao.id);
    const linha = lida?.itens.find((item) => item.itemRevisionalId === avulso.id);

    expect(linha?.itemRevisional.categoria).toBeNull();
    expect(linha?.itemRevisional.grupo).toBeNull();
  });
});
