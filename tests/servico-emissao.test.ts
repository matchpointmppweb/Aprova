import { beforeEach, describe, expect, test } from "vitest";

import { TETO_DE_MINUTOS } from "@/src/lib/duracao";
import {
  atualizarEmissao,
  buscarEmissao,
  criarEmissao,
  isViolacaoDeServicoIncoerente,
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
  test("backfill: linha já existente fica com modo Periodo", async () => {
    const cenario = await criarEmissaoCompleta();

    // O caminho legado: escrita que não conhece os campos novos. É o mesmo
    // efeito que o DEFAULT da migration produziu nas linhas já gravadas.
    //
    // Story 7.3: a linha PRECISA agora trazer os dois marcos — o ramo `Periodo`
    // da CHECK deixou de aceitar período sem datas (o caso "sem datas" migrou
    // para a matriz de recusas abaixo). O que continua valendo, e é o ponto
    // deste teste, é que a omissão de `modo` cai em `Periodo`.
    const comDatas = await db.servicoEmissao.create({
      data: {
        emissaoId: cenario.emissao.id,
        pessoaId: cenario.pessoa.id,
        itemRevisionalId: cenario.item.id,
        inicio: new Date(Date.UTC(2026, 0, 15, 8, 0)),
        fim: new Date(Date.UTC(2026, 0, 15, 9, 55)),
      },
    });

    expect(comDatas.modo).toBe("Periodo");
    expect(comDatas.duracaoMinutos).toBeNull();

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
      // `inicio`/`fim` vão explícitos porque o ramo `Periodo` da CHECK passou a
      // exigi-los (Story 7.3) — a coluna que este teste OMITE, e cuja resposta
      // ele quer do banco, continua sendo `modo`.
      `INSERT INTO "servicos_emissao" ("id","emissaoId","pessoaId","itemRevisionalId","inicio","fim")
       VALUES ($1,$2,$3,$4,$5,$6)`,
      "servico-sql-cru",
      cenario.emissao.id,
      cenario.pessoa.id,
      cenario.item.id,
      new Date(Date.UTC(2026, 0, 15, 8, 0)),
      new Date(Date.UTC(2026, 0, 15, 9, 0)),
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

    // Story 7.2 — o teto. A CHECK não entra na checagem de deriva (o Prisma
    // não modela constraints), então este teste é a ÚNICA coisa que garante
    // que a cláusula do banco e `TETO_DE_MINUTOS` são o mesmo número: o teto
    // exato passa, um minuto além é recusado. Se a migration for reescrita com
    // outro limite, um dos dois lados quebra aqui.
    test("o teto da CHECK é o mesmo TETO_DE_MINUTOS do módulo", async () => {
      const cenario = await criarEmissaoCompleta();
      const base = {
        emissaoId: cenario.emissao.id,
        pessoaId: cenario.pessoa.id,
        itemRevisionalId: cenario.item.id,
        modo: "Duracao" as const,
      };

      await inserirServico({ ...base, duracaoMinutos: TETO_DE_MINUTOS });
      expect(await db.servicoEmissao.count()).toBe(1);

      await expect(
        inserirServico({ ...base, duracaoMinutos: TETO_DE_MINUTOS + 1 }),
      ).rejects.toThrow();
      expect(await db.servicoEmissao.count()).toBe(1);
    });

    // Story 7.3 — o ramo `Periodo`, que a 7.1 deixou frouxo de propósito e só
    // agora pôde apertar (a Server Action passou a exigir os dois marcos e a
    // validar o intervalo ANTES). A CHECK recusa exatamente o que
    // `duracaoDoPeriodo` recusa: nem mais (período que a tela aceita e o banco
    // rejeita), nem menos (linha que o módulo não sabe ler).
    describe("ramo Periodo (Story 7.3)", () => {
      const MARCO = new Date(Date.UTC(2026, 0, 15, 8, 0));

      test.each([
        ["sem nenhum marco", { inicio: null, fim: null }],
        ["só com o início", { inicio: MARCO, fim: null }],
        ["só com o fim", { inicio: null, fim: MARCO }],
        [
          "com fim anterior ao início",
          { inicio: MARCO, fim: new Date(Date.UTC(2026, 0, 15, 7, 0)) },
        ],
        ["com fim igual ao início", { inicio: MARCO, fim: MARCO }],
      ])("Periodo %s é recusado", async (_rotulo, marcos) => {
        const cenario = await criarEmissaoCompleta();
        await expect(
          inserirServico({
            emissaoId: cenario.emissao.id,
            pessoaId: cenario.pessoa.id,
            itemRevisionalId: cenario.item.id,
            modo: "Periodo",
            ...marcos,
          }),
        ).rejects.toThrow();
        expect(await db.servicoEmissao.count()).toBe(0);
      });

      // AC: "o mesmo número nos três" — TETO_DE_MINUTOS, a cláusula do ramo
      // Duracao e a do ramo Periodo. O intervalo exato passa, um minuto além é
      // recusado; se a migration for reescrita com outro limite num dos ramos,
      // este teste ou o irmão acima quebra.
      test("o teto do ramo Periodo é o mesmo TETO_DE_MINUTOS", async () => {
        const cenario = await criarEmissaoCompleta();
        const base = {
          emissaoId: cenario.emissao.id,
          pessoaId: cenario.pessoa.id,
          itemRevisionalId: cenario.item.id,
          modo: "Periodo" as const,
          inicio: MARCO,
        };
        const depoisDe = (minutos: number) => new Date(MARCO.getTime() + minutos * 60_000);

        await inserirServico({ ...base, fim: depoisDe(TETO_DE_MINUTOS) });
        expect(await db.servicoEmissao.count()).toBe(1);

        await expect(
          inserirServico({ ...base, fim: depoisDe(TETO_DE_MINUTOS + 1) }),
        ).rejects.toThrow();
        expect(await db.servicoEmissao.count()).toBe(1);
      });
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

    // I/O Matrix "Violação da CHECK" (Story 7.3): uma escrita incoerente que
    // escape da validação vira DESFECHO CLASSIFICADO, nunca erro cru do Prisma
    // subindo como 500. A linha abaixo passa pelo tipo (é o ramo legado, com
    // marcos opcionais) e é o banco quem a recusa — exatamente o cenário de
    // "validação e CHECK divergiram".
    test("escrita incoerente vira motivo servico-incoerente, não exceção", async () => {
      const cenario = await criarEmissaoCompleta();

      const criada = await criarEmissao(cenario.conta.id, {
        ativoId: cenario.ativo.id,
        planoId: cenario.plano.id,
        responsavelId: cenario.identidade.id,
        dataEmissao: new Date(Date.UTC(2026, 1, 6)),
        setor: "Manutencao",
        dataAgendamento: null,
        dataInicio: null,
        dataFim: null,
        itens: [],
        servicos: [],
      });

      const resultado = await atualizarEmissao(
        cenario.conta.id,
        criada.id,
        criada.updatedAt,
        {
          ativoId: cenario.ativo.id,
          planoId: cenario.plano.id,
          responsavelId: cenario.identidade.id,
          dataEmissao: new Date(Date.UTC(2026, 1, 6)),
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
              inicio: null,
              fim: null,
            },
          ],
        },
      );

      expect(resultado).toEqual({ ok: false, motivo: "servico-incoerente" });
      // A transação abortou por inteiro — nada gravado pela metade (AD-9).
      expect(await db.servicoEmissao.count()).toBe(0);
    });

    // O irmão do teste acima no caminho de CRIAÇÃO — que grava por nested
    // create, não por createMany. A mensagem de erro do Prisma pode ter outra
    // forma nos dois caminhos; se tiver, a criação cairia em ERRO_GENERICO e o
    // modal nem trocaria de aba. Só um teste contra o banco real percebe.
    test("criarEmissao com linha incoerente é classificado como violação da CHECK", async () => {
      const cenario = await criarEmissaoCompleta();
      const emissoesAntes = await db.emissao.count();

      const criar = criarEmissao(cenario.conta.id, {
        ativoId: cenario.ativo.id,
        planoId: cenario.plano.id,
        responsavelId: cenario.identidade.id,
        dataEmissao: new Date(Date.UTC(2026, 1, 7)),
        setor: "Manutencao",
        dataAgendamento: null,
        dataInicio: null,
        dataFim: null,
        itens: [],
        servicos: [
          // Ramo LEGADO: passa pelo tipo (marcos opcionais) e é o banco quem
          // recusa — o cenário "validação e CHECK divergiram".
          {
            pessoaId: cenario.pessoa.id,
            itemRevisionalId: cenario.item.id,
            inicio: null,
            fim: null,
          },
        ],
      });

      const lancado = await criar.then(
        () => null,
        (erro: unknown) => erro ?? new Error("rejeitou sem erro"),
      );
      expect(lancado).not.toBeNull();
      expect(isViolacaoDeServicoIncoerente(lancado)).toBe(true);
      // A transação abortou por inteiro: nem emissão, nem serviço (AD-9).
      expect(await db.emissao.count()).toBe(emissoesAntes);
      expect(await db.servicoEmissao.count()).toBe(0);
    });

    // O caso negativo: sem ele, um `isViolacaoDeServicoIncoerente` que
    // devolvesse `true` para tudo passaria nos dois testes acima — e toda falha
    // de escrita viraria "revise as horas lançadas".
    test("um erro qualquer NÃO é classificado como violação da CHECK", () => {
      expect(isViolacaoDeServicoIncoerente(new Error("falha de conexão"))).toBe(false);
      expect(isViolacaoDeServicoIncoerente("servicos_emissao_modo_coerente")).toBe(false);
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
            // Story 7.3: o caminho legado continua compilando sem os campos
            // novos, mas os marcos deixaram de ser opcionais no banco.
            inicio: new Date(Date.UTC(2026, 1, 4, 8, 0)),
            fim: new Date(Date.UTC(2026, 1, 4, 10, 0)),
          },
        ],
      });

      expect(criada.servicos).toHaveLength(1);
      expect(criada.servicos[0].modo).toBe("Periodo");
      expect(criada.servicos[0].duracaoMinutos).toBeNull();
    });
  });
});
