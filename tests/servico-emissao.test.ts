import { beforeEach, describe, expect, test } from "vitest";

import {
  atualizarEmissao,
  buscarEmissao,
  criarEmissao,
} from "@/src/server/repositories/emissao";

import { criarEmissaoCompleta, db, limparBanco } from "./setup/fixtures";

beforeEach(limparBanco);

// Story 7.1 — modo do lançamento e duração em minutos. O que estes testes
// protegem é a GARANTIA ESTRUTURAL: a CHECK `servicos_emissao_modo_coerente`
// é o único ponto por onde passam os dois caminhos de escrita de hoje (nested
// create da criação, createMany da edição) e o terceiro que nasce na 7.3.
// Por isso cada incoerência é tentada contra o banco REAL, pelo client próprio
// dos testes — não pela validação da aplicação, que aqui não é a rede de
// segurança.

async function inserirServico(dados: {
  emissaoId: string;
  pessoaId: string;
  itemRevisionalId: string;
  modo: "Duracao" | "Periodo";
  duracaoMinutos?: number | null;
  inicio?: Date | null;
  fim?: Date | null;
}) {
  return db.servicoEmissao.create({
    data: {
      emissaoId: dados.emissaoId,
      pessoaId: dados.pessoaId,
      itemRevisionalId: dados.itemRevisionalId,
      modo: dados.modo,
      duracaoMinutos: dados.duracaoMinutos ?? null,
      inicio: dados.inicio ?? null,
      fim: dados.fim ?? null,
    },
  });
}

describe("ServicoEmissao: modo e duração (Story 7.1)", () => {
  test("backfill: linha já existente fica com modo Periodo, com ou sem datas", async () => {
    const cenario = await criarEmissaoCompleta();

    // O caminho legado: escrita que não conhece os campos novos. É o mesmo
    // efeito que o DEFAULT da migration produziu nas linhas já gravadas.
    const comDatas = await db.servicoEmissao.create({
      data: {
        emissaoId: cenario.emissao.id,
        pessoaId: cenario.pessoa.id,
        itemRevisionalId: cenario.item.id,
        inicio: new Date(Date.UTC(2026, 0, 15, 8, 0)),
        fim: new Date(Date.UTC(2026, 0, 15, 9, 55)),
      },
    });
    const semDatas = await db.servicoEmissao.create({
      data: {
        emissaoId: cenario.emissao.id,
        pessoaId: cenario.pessoa.id,
        itemRevisionalId: cenario.item.id,
      },
    });

    expect(comDatas.modo).toBe("Periodo");
    expect(comDatas.duracaoMinutos).toBeNull();
    expect(semDatas.modo).toBe("Periodo");

    // AC: "nenhuma linha fica com `modo` nulo". O Prisma nem deixa expressar a
    // pergunta (a coluna é NOT NULL no datamodel) — daí o SQL cru.
    const [{ nulos }] = await db.$queryRawUnsafe<{ nulos: bigint }[]>(
      `SELECT COUNT(*)::bigint AS nulos FROM "servicos_emissao" WHERE "modo" IS NULL`,
    );
    expect(Number(nulos)).toBe(0);
  });

  // As duas asserções acima passam pelo Prisma, e o Prisma aplica o
  // `@default(Periodo)` do datamodel POR CONTA PRÓPRIA — ele manda o valor no
  // INSERT em vez de deixar o banco decidir. Ou seja: elas nunca tocam o
  // `DEFAULT 'Periodo'` do SQL, que é exatamente o que preencheu as linhas
  // gravadas ANTES da migration. Trocar o default da migration para 'Duracao'
  // passava por toda a suíte em silêncio — verificado reintroduzindo o defeito.
  //
  // Este teste insere por SQL cru, omitindo a coluna, para que quem responda
  // seja o banco.
  test("o DEFAULT da migration — e não o do Prisma — é Periodo", async () => {
    const cenario = await criarEmissaoCompleta();

    await db.$executeRawUnsafe(
      `INSERT INTO "servicos_emissao" ("id","emissaoId","pessoaId","itemRevisionalId")
       VALUES ($1,$2,$3,$4)`,
      "servico-sql-cru",
      cenario.emissao.id,
      cenario.pessoa.id,
      cenario.item.id,
    );

    const [linha] = await db.$queryRawUnsafe<{ modo: string }[]>(
      `SELECT "modo"::text AS modo FROM "servicos_emissao" WHERE "id" = 'servico-sql-cru'`,
    );
    expect(linha.modo).toBe("Periodo");
  });

  test("modo Duracao grava e relê os minutos inteiros", async () => {
    const cenario = await criarEmissaoCompleta();

    await inserirServico({
      emissaoId: cenario.emissao.id,
      pessoaId: cenario.pessoa.id,
      itemRevisionalId: cenario.item.id,
      modo: "Duracao",
      duracaoMinutos: 115,
    });

    const relido = await db.servicoEmissao.findFirstOrThrow({
      where: { emissaoId: cenario.emissao.id },
    });
    // 115 minutos é o "1:55" do enunciado — armazenado SEMPRE em minutos
    // inteiros (AD-28); a formatação é da 7.2.
    expect(relido.duracaoMinutos).toBe(115);
    expect(relido.modo).toBe("Duracao");
    expect(relido.inicio).toBeNull();
    expect(relido.fim).toBeNull();
  });

  test("modo Periodo grava e relê as datas, com duração nula", async () => {
    const cenario = await criarEmissaoCompleta();
    const inicio = new Date(Date.UTC(2026, 0, 15, 8, 0));
    const fim = new Date(Date.UTC(2026, 0, 15, 9, 55));

    await inserirServico({
      emissaoId: cenario.emissao.id,
      pessoaId: cenario.pessoa.id,
      itemRevisionalId: cenario.item.id,
      modo: "Periodo",
      inicio,
      fim,
    });

    const relido = await db.servicoEmissao.findFirstOrThrow({
      where: { emissaoId: cenario.emissao.id },
    });
    expect(relido.inicio?.toISOString()).toBe(inicio.toISOString());
    expect(relido.fim?.toISOString()).toBe(fim.toISOString());
    expect(relido.duracaoMinutos).toBeNull();
  });

  describe("a CHECK recusa cada incoerência da matriz", () => {
    test("Duracao com data de início", async () => {
      const cenario = await criarEmissaoCompleta();
      await expect(
        inserirServico({
          emissaoId: cenario.emissao.id,
          pessoaId: cenario.pessoa.id,
          itemRevisionalId: cenario.item.id,
          modo: "Duracao",
          duracaoMinutos: 115,
          inicio: new Date(Date.UTC(2026, 0, 15, 8, 0)),
        }),
      ).rejects.toThrow();
      expect(await db.servicoEmissao.count()).toBe(0);
    });

    test("Duracao sem minutos", async () => {
      const cenario = await criarEmissaoCompleta();
      await expect(
        inserirServico({
          emissaoId: cenario.emissao.id,
          pessoaId: cenario.pessoa.id,
          itemRevisionalId: cenario.item.id,
          modo: "Duracao",
          duracaoMinutos: null,
        }),
      ).rejects.toThrow();
      expect(await db.servicoEmissao.count()).toBe(0);
    });

    test("Periodo com minutos preenchidos", async () => {
      const cenario = await criarEmissaoCompleta();
      await expect(
        inserirServico({
          emissaoId: cenario.emissao.id,
          pessoaId: cenario.pessoa.id,
          itemRevisionalId: cenario.item.id,
          modo: "Periodo",
          duracaoMinutos: 115,
        }),
      ).rejects.toThrow();
      expect(await db.servicoEmissao.count()).toBe(0);
    });

    // Zero não é lançamento (NFR7) — e negativo muito menos.
    test.each([0, -30])("Duracao com %i minutos", async (minutos) => {
      const cenario = await criarEmissaoCompleta();
      await expect(
        inserirServico({
          emissaoId: cenario.emissao.id,
          pessoaId: cenario.pessoa.id,
          itemRevisionalId: cenario.item.id,
          modo: "Duracao",
          duracaoMinutos: minutos,
        }),
      ).rejects.toThrow();
      expect(await db.servicoEmissao.count()).toBe(0);
    });
  });

  // O repositório é o que a 7.3 vai usar para gravar: os dois campos precisam
  // atravessar a escrita E voltar nas leituras (os três caminhos compartilham
  // o mesmo INCLUDE_LISTAGEM).
  describe("repositório de emissão", () => {
    test("criarEmissao grava os dois modos e buscarEmissao os devolve", async () => {
      const cenario = await criarEmissaoCompleta();

      const criada = await criarEmissao(cenario.conta.id, {
        ativoId: cenario.ativo.id,
        planoId: cenario.plano.id,
        responsavelId: cenario.identidade.id,
        dataEmissao: new Date(Date.UTC(2026, 1, 3)),
        setor: "Manutencao",
        dataAgendamento: null,
        dataInicio: null,
        dataFim: null,
        itens: [],
        servicos: [
          {
            pessoaId: cenario.pessoa.id,
            itemRevisionalId: cenario.item.id,
            inicio: null,
            fim: null,
            modo: "Duracao",
            duracaoMinutos: 115,
          },
          {
            pessoaId: cenario.pessoa.id,
            itemRevisionalId: cenario.item.id,
            inicio: new Date(Date.UTC(2026, 1, 3, 8, 0)),
            fim: new Date(Date.UTC(2026, 1, 3, 10, 0)),
            modo: "Periodo",
            duracaoMinutos: null,
          },
        ],
      });

      const relida = await buscarEmissao(cenario.conta.id, criada.id);
      const porModo = Object.fromEntries(
        (relida?.servicos ?? []).map((servico) => [servico.modo, servico]),
      );
      expect(porModo.Duracao?.duracaoMinutos).toBe(115);
      expect(porModo.Periodo?.duracaoMinutos).toBeNull();
      expect(porModo.Periodo?.inicio).not.toBeNull();
    });

    // Segundo ponto de escrita dos campos novos (createMany da edição, AD-20).
    // Sem este teste, apagar `modo`/`duracaoMinutos` do createMany regravaria a
    // linha como `Periodo` sem minutos — coerente para a CHECK, e a suíte
    // inteira seguiria verde.
    test("atualizarEmissao regrava o serviço preservando modo e duração", async () => {
      const cenario = await criarEmissaoCompleta();

      const criada = await criarEmissao(cenario.conta.id, {
        ativoId: cenario.ativo.id,
        planoId: cenario.plano.id,
        responsavelId: cenario.identidade.id,
        dataEmissao: new Date(Date.UTC(2026, 1, 5)),
        setor: "Manutencao",
        dataAgendamento: null,
        dataInicio: null,
        dataFim: null,
        itens: [],
        servicos: [
          {
            pessoaId: cenario.pessoa.id,
            itemRevisionalId: cenario.item.id,
            inicio: new Date(Date.UTC(2026, 1, 5, 8, 0)),
            fim: new Date(Date.UTC(2026, 1, 5, 10, 0)),
            modo: "Periodo",
          },
        ],
      });

      const resultado = await atualizarEmissao(
        cenario.conta.id,
        criada.id,
        criada.updatedAt,
        {
          ativoId: cenario.ativo.id,
          planoId: cenario.plano.id,
          responsavelId: cenario.identidade.id,
          dataEmissao: new Date(Date.UTC(2026, 1, 5)),
          setor: "Manutencao",
          dataAgendamento: null,
          dataInicio: null,
          dataFim: null,
          trocouPlano: false,
          itens: [],
          servicos: [
            {
              pessoaId: cenario.pessoa.id,
              itemRevisionalId: cenario.item.id,
              modo: "Duracao",
              duracaoMinutos: 115,
            },
          ],
        },
      );
      expect(resultado).toEqual({ ok: true });

      const relida = await buscarEmissao(cenario.conta.id, criada.id);
      expect(relida?.servicos).toHaveLength(1);
      expect(relida?.servicos[0].modo).toBe("Duracao");
      expect(relida?.servicos[0].duracaoMinutos).toBe(115);
    });

    // I/O Matrix "Escrita legada": o caminho atual (Server Action da 5.5, não
    // tocada nesta story) não informa os campos novos e continua gravando.
    test("escrita sem modo cai em Periodo", async () => {
      const cenario = await criarEmissaoCompleta();

      const criada = await criarEmissao(cenario.conta.id, {
        ativoId: cenario.ativo.id,
        planoId: cenario.plano.id,
        responsavelId: cenario.identidade.id,
        dataEmissao: new Date(Date.UTC(2026, 1, 4)),
        setor: "Manutencao",
        dataAgendamento: null,
        dataInicio: null,
        dataFim: null,
        itens: [],
        servicos: [
          {
            pessoaId: cenario.pessoa.id,
            itemRevisionalId: cenario.item.id,
            inicio: null,
            fim: null,
          },
        ],
      });

      expect(criada.servicos).toHaveLength(1);
      expect(criada.servicos[0].modo).toBe("Periodo");
      expect(criada.servicos[0].duracaoMinutos).toBeNull();
    });
  });
});
