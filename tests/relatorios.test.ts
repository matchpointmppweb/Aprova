import { beforeEach, describe, expect, test } from "vitest";

import {
  CATEGORIAS_DE_RELATORIO,
  CATEGORIA_PADRAO,
  ERRO_DATA_INVALIDA,
  ERRO_PERIODO_INVERTIDO,
  RELATORIOS,
  agruparEmissoesPorAtivo,
  agruparServicosPorPessoa,
  interpretarPeriodo,
  isCategoriaDeRelatorio,
  montarServicosPorPessoa,
  type EmissaoDoRelatorio,
  type LancamentoDeServico,
} from "@/src/lib/relatorios";
import {
  ativosComUltimaEmissao,
  emissoesComServicos,
  itensPendentes,
  lancamentosDeServico,
  pessoasDoRelatorio,
} from "@/src/server/repositories/relatorio";

import { criarAtivo, criarEmissaoCompleta, criarPessoa, db, limparBanco } from "./setup/fixtures";

beforeEach(limparBanco);

const SEM_PERIODO = { de: null, ate: null };

// C3 — os relatórios. Três coisas sob teste, nesta ordem de risco:
//  1. a borda do PERÍODO, onde mora o erro clássico de relatório (o último
//     dia que some);
//  2. a AGREGAÇÃO, que é a única aritmética da tela;
//  3. o escopo por conta das consultas (AD-1), que nenhuma camada acima pega.

describe("catálogo", () => {
  test("toda categoria listada tem definição, e o padrão é uma delas", () => {
    for (const chave of CATEGORIAS_DE_RELATORIO) {
      expect(RELATORIOS[chave]).toBeDefined();
      expect(RELATORIOS[chave].titulo.length).toBeGreaterThan(0);
    }
    expect(isCategoriaDeRelatorio(CATEGORIA_PADRAO)).toBe(true);
  });

  test("categoria desconhecida é recusada pelo guard", () => {
    expect(isCategoriaDeRelatorio("faturamento")).toBe(false);
    expect(isCategoriaDeRelatorio("")).toBe(false);
  });
});

describe("interpretarPeriodo", () => {
  test("a data final é INCLUSIVA — vai até o fim do dia", () => {
    const leitura = interpretarPeriodo("2026-10-01", "2026-10-31");
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;

    expect(leitura.periodo.de?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    // Este é o teste que importa: com `lte` na meia-noite de 31/10, tudo o
    // que aconteceu NAQUELE dia depois de 00:00 sumiria do relatório — e
    // sumiria calado, que é o pior jeito de um número estar errado.
    expect(leitura.periodo.ate?.toISOString()).toBe("2026-10-31T23:59:59.999Z");
  });

  test("os dois lados são opcionais e independentes", () => {
    const soDe = interpretarPeriodo("2026-10-01", "");
    expect(soDe.ok && soDe.periodo.de).toBeInstanceOf(Date);
    expect(soDe.ok && soDe.periodo.ate).toBeNull();

    const soAte = interpretarPeriodo("", "2026-10-31");
    expect(soAte.ok && soAte.periodo.de).toBeNull();
    expect(soAte.ok && soAte.periodo.ate).toBeInstanceOf(Date);

    const nenhum = interpretarPeriodo("", "   ");
    expect(nenhum.ok && nenhum.periodo).toEqual(SEM_PERIODO);
  });

  test("data malformada ou inexistente é recusada, não normalizada", () => {
    for (const bruto of ["31/10/2026", "2026-13-01", "2026-02-30", "2026-10"]) {
      const leitura = interpretarPeriodo(bruto, "");
      expect(leitura.ok).toBe(false);
      expect(leitura.ok === false && leitura.erro).toBe(ERRO_DATA_INVALIDA);
    }
  });

  test("período invertido é recusado, mas o mesmo dia nos dois lados vale", () => {
    const invertido = interpretarPeriodo("2026-10-31", "2026-10-01");
    expect(invertido.ok === false && invertido.erro).toBe(ERRO_PERIODO_INVERTIDO);

    // Um único dia é pergunta legítima ("o que rolou em 15/10?") e só passa
    // porque `ate` é o FIM daquele dia — com as duas bordas à meia-noite
    // isto seria um intervalo vazio.
    const mesmoDia = interpretarPeriodo("2026-10-15", "2026-10-15");
    expect(mesmoDia.ok).toBe(true);
    if (!mesmoDia.ok) return;
    expect(mesmoDia.periodo.ate!.getTime()).toBeGreaterThan(mesmoDia.periodo.de!.getTime());
  });
});

describe("agruparServicosPorPessoa", () => {
  function lancamento(parcial: Partial<LancamentoDeServico> & { pessoaId: string }) {
    return {
      pessoaNome: `Pessoa ${parcial.pessoaId}`,
      cargo: "Mecânico",
      modo: "Duracao" as const,
      duracaoMinutos: 60,
      inicio: null,
      fim: null,
      ...parcial,
    } as LancamentoDeServico;
  }

  test("soma as horas de cada pessoa separadamente", () => {
    // DUAS pessoas de propósito: com uma só, um agrupamento que ignorasse a
    // chave devolveria o mesmo total e o defeito passaria.
    const agrupado = agruparServicosPorPessoa([
      lancamento({ pessoaId: "ana", duracaoMinutos: 90 }),
      lancamento({ pessoaId: "bia", duracaoMinutos: 30 }),
      lancamento({ pessoaId: "ana", duracaoMinutos: 45 }),
    ]);

    expect(agrupado).toHaveLength(2);
    const ana = agrupado.find((linha) => linha.pessoaId === "ana");
    expect(ana?.minutos).toBe(135);
    expect(ana?.lancamentos).toBe(2);
    expect(agrupado.find((linha) => linha.pessoaId === "bia")?.minutos).toBe(30);
  });

  test("ordena por horas decrescentes, com o nome desempatando", () => {
    const agrupado = agruparServicosPorPessoa([
      lancamento({ pessoaId: "c", pessoaNome: "Carlos", duracaoMinutos: 30 }),
      lancamento({ pessoaId: "a", pessoaNome: "Ana", duracaoMinutos: 120 }),
      // Mesmo total que Carlos — o desempate por nome é o que torna a ordem
      // estável entre duas gerações do mesmo relatório.
      lancamento({ pessoaId: "b", pessoaNome: "Bruno", duracaoMinutos: 30 }),
    ]);

    expect(agrupado.map((linha) => linha.pessoaNome)).toEqual(["Ana", "Bruno", "Carlos"]);
  });

  test("a linha sem duração apurável é CONTADA mas não somada", () => {
    const agrupado = agruparServicosPorPessoa([
      lancamento({ pessoaId: "ana", duracaoMinutos: 60 }),
      // Linha legada da 5.5: `Periodo` sem marcos. Ela existe e a pessoa a vê
      // na emissão, então contá-la é honesto; somá-la como zero não seria
      // diferente, mas deixar de contá-la esconderia trabalho registrado.
      lancamento({ pessoaId: "ana", modo: "Periodo", duracaoMinutos: null }),
    ]);

    expect(agrupado[0].lancamentos).toBe(2);
    expect(agrupado[0].minutos).toBe(60);
  });

  test("o total do rodapé bate com a soma das linhas", () => {
    const tabela = montarServicosPorPessoa([
      lancamento({ pessoaId: "ana", duracaoMinutos: 90 }),
      lancamento({ pessoaId: "bia", duracaoMinutos: 150 }),
    ]);

    expect(tabela.total?.horas).toBe("4:00");
    expect(tabela.total?.lancamentos).toBe("2");
    expect(tabela.total?.pessoa).toBe("2 pessoas");
  });

  test("sem lançamentos a tabela sai vazia, com total zerado", () => {
    const tabela = montarServicosPorPessoa([]);
    expect(tabela.linhas).toEqual([]);
    expect(tabela.total?.horas).toBe("0:00");
  });
});

describe("agruparEmissoesPorAtivo", () => {
  function emissao(parcial: Partial<EmissaoDoRelatorio> & { ativoId: string }): EmissaoDoRelatorio {
    return {
      ativoCodigo: `AT-${parcial.ativoId}`,
      ativoNome: `Ativo ${parcial.ativoId}`,
      status: "Emitido",
      servicos: [],
      ...parcial,
    };
  }

  test("conta cada situação na sua coluna", () => {
    // Os quatro status num ativo só: se duas colunas estivessem trocadas na
    // contagem, um cenário com um status por ativo não revelaria.
    const [linha] = agruparEmissoesPorAtivo([
      emissao({ ativoId: "x", status: "Rascunho" }),
      emissao({ ativoId: "x", status: "EmAnalise" }),
      emissao({ ativoId: "x", status: "Emitido" }),
      emissao({ ativoId: "x", status: "Reprovado" }),
      emissao({ ativoId: "x", status: "Emitido" }),
    ]);

    expect(linha.total).toBe(5);
    expect(linha.rascunho).toBe(1);
    expect(linha.emAnalise).toBe(1);
    expect(linha.emitido).toBe(2);
    expect(linha.reprovado).toBe(1);
  });

  test("soma as horas das emissões do ativo e separa por ativo", () => {
    const agrupado = agruparEmissoesPorAtivo([
      emissao({
        ativoId: "a",
        servicos: [
          { modo: "Duracao", duracaoMinutos: 60, inicio: null, fim: null },
          { modo: "Duracao", duracaoMinutos: 30, inicio: null, fim: null },
        ],
      }),
      emissao({
        ativoId: "b",
        servicos: [{ modo: "Duracao", duracaoMinutos: 15, inicio: null, fim: null }],
      }),
    ]);

    expect(agrupado.find((linha) => linha.ativoId === "a")?.minutos).toBe(90);
    expect(agrupado.find((linha) => linha.ativoId === "b")?.minutos).toBe(15);
  });

  test("ordena pelo código do ativo", () => {
    const agrupado = agruparEmissoesPorAtivo([
      emissao({ ativoId: "2", ativoCodigo: "AT-0002" }),
      emissao({ ativoId: "1", ativoCodigo: "AT-0001" }),
    ]);
    expect(agrupado.map((linha) => linha.ativoCodigo)).toEqual(["AT-0001", "AT-0002"]);
  });
});

describe("consultas escopadas por conta (AD-1)", () => {
  async function duasContasComDado() {
    const minha = await criarEmissaoCompleta();
    const outra = await criarEmissaoCompleta({ nomeDaConta: "Outra conta" });

    for (const cenario of [minha, outra]) {
      await db.servicoEmissao.create({
        data: {
          emissaoId: cenario.emissao.id,
          pessoaId: cenario.pessoa.id,
          itemRevisionalId: cenario.item.id,
          modo: "Duracao",
          duracaoMinutos: 60,
        },
      });
      await db.itemExecutadoEmissao.create({
        data: {
          emissaoId: cenario.emissao.id,
          itemRevisionalId: cenario.item.id,
          executado: false,
        },
      });
    }
    return { minha, outra };
  }

  test("nenhuma consulta enxerga dado de outra conta", async () => {
    // A outra conta tem EXATAMENTE o mesmo dado: sem ela no banco, um
    // `where` sem contaId devolveria o mesmo resultado e passaria.
    const { minha } = await duasContasComDado();

    const servicos = await lancamentosDeServico(minha.conta.id, SEM_PERIODO);
    expect(servicos).toHaveLength(1);
    expect(servicos[0].pessoa.id).toBe(minha.pessoa.id);

    const emissoes = await emissoesComServicos(minha.conta.id, SEM_PERIODO);
    expect(emissoes).toHaveLength(1);
    expect(emissoes[0].ativo.id).toBe(minha.ativo.id);

    const pendentes = await itensPendentes(minha.conta.id, SEM_PERIODO);
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0].emissao.codigo).toBe(minha.emissao.codigo);

    const ativos = await ativosComUltimaEmissao(minha.conta.id);
    expect(ativos.map((ativo) => ativo.codigo)).toEqual([minha.ativo.codigo]);

    const pessoas = await pessoasDoRelatorio(minha.conta.id);
    expect(pessoas.map((pessoa) => pessoa.nome)).toEqual([minha.pessoa.nome]);
  });

  test("o período recorta pela data da emissão, incluindo o último dia", async () => {
    const cenario = await criarEmissaoCompleta();
    // Uma emissão às 18h do último dia do período: é ela que desaparece se a
    // borda final for a meia-noite em vez do fim do dia.
    await db.emissao.update({
      where: { id: cenario.emissao.id },
      data: { dataEmissao: new Date("2026-10-31T18:00:00.000Z") },
    });
    await db.servicoEmissao.create({
      data: {
        emissaoId: cenario.emissao.id,
        pessoaId: cenario.pessoa.id,
        itemRevisionalId: cenario.item.id,
        modo: "Duracao",
        duracaoMinutos: 60,
      },
    });

    const dentro = interpretarPeriodo("2026-10-01", "2026-10-31");
    expect(dentro.ok).toBe(true);
    if (!dentro.ok) return;
    expect(await lancamentosDeServico(cenario.conta.id, dentro.periodo)).toHaveLength(1);

    const fora = interpretarPeriodo("2026-11-01", "2026-11-30");
    expect(fora.ok).toBe(true);
    if (!fora.ok) return;
    expect(await lancamentosDeServico(cenario.conta.id, fora.periodo)).toHaveLength(0);
  });

  test("itens pendentes traz só os NÃO executados", async () => {
    const cenario = await criarEmissaoCompleta();
    const outroItem = await db.itemRevisional.create({
      data: { contaId: cenario.conta.id, nome: "Item executado", horasPadrao: 10 },
    });
    await db.itemExecutadoEmissao.create({
      data: {
        emissaoId: cenario.emissao.id,
        itemRevisionalId: cenario.item.id,
        executado: false,
      },
    });
    // O vizinho executado é o que distingue "pendentes" de "todos".
    await db.itemExecutadoEmissao.create({
      data: { emissaoId: cenario.emissao.id, itemRevisionalId: outroItem.id, executado: true },
    });

    const pendentes = await itensPendentes(cenario.conta.id, SEM_PERIODO);
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0].itemRevisional.nome).toBe(cenario.item.nome);
  });

  test("ativo nunca revisado aparece, com zero emissões", async () => {
    const cenario = await criarEmissaoCompleta();
    const semEmissao = await criarAtivo(cenario.conta.id, cenario.tipoAtivo.id, {
      nome: "Nunca revisado",
    });

    const ativos = await ativosComUltimaEmissao(cenario.conta.id);
    const linha = ativos.find((ativo) => ativo.codigo === semEmissao.codigo);

    // Some-lo seria o erro silencioso deste relatório: o ativo sem revisão é
    // justamente o que a pessoa está procurando.
    expect(linha).toBeDefined();
    expect(linha?._count.emissoes).toBe(0);
    expect(linha?.emissoes).toEqual([]);

    // DUAS emissões no ativo revisado, com datas diferentes: com uma só,
    // "a mais recente" e "a mais antiga" são a mesma linha, e inverter a
    // ordenação da consulta passaria despercebido. Verificado por mutação —
    // era exatamente este o furo.
    const antiga = await db.emissao.create({
      data: {
        contaId: cenario.conta.id,
        ativoId: cenario.ativo.id,
        planoId: cenario.plano.id,
        responsavelId: cenario.identidade.id,
        dataEmissao: new Date("2020-01-01T00:00:00.000Z"),
        codigo: "EM-2020-0001",
        ano: 2020,
        seq: 9001,
      },
    });
    await db.emissao.update({
      where: { id: cenario.emissao.id },
      data: { dataEmissao: new Date("2026-10-20T00:00:00.000Z") },
    });

    const depois = await ativosComUltimaEmissao(cenario.conta.id);
    const revisado = depois.find((ativo) => ativo.codigo === cenario.ativo.codigo);

    expect(revisado?._count.emissoes).toBe(2);
    expect(revisado?.emissoes).toHaveLength(1);
    expect(revisado?.emissoes[0].codigo).toBe(cenario.emissao.codigo);
    expect(revisado?.emissoes[0].codigo).not.toBe(antiga.codigo);
  });

  test("pessoa sem lançamento nenhum aparece no relatório de pessoas", async () => {
    const cenario = await criarEmissaoCompleta();
    const semServico = await criarPessoa(cenario.conta.id, { nome: "Aaa Sem serviço" });

    const pessoas = await pessoasDoRelatorio(cenario.conta.id);
    const linha = pessoas.find((pessoa) => pessoa.nome === semServico.nome);

    expect(linha).toBeDefined();
    expect(linha?._count.servicosEmissao).toBe(0);
  });
});
