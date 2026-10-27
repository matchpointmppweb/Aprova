import { beforeEach, describe, expect, test, vi } from "vitest";

import { TETO_DE_MINUTOS } from "@/src/lib/duracao";
import {
  anoNoFusoDeNegocio,
  atualizarEmissao,
  buscarEmissao,
  criarEmissao,
  isViolacaoDeServicoIncoerente,
} from "@/src/server/repositories/emissao";

// Story 7.5 — as duas Server Actions de emissão entram na suíte. O único dublê
// é a SESSÃO (que só existe dentro de uma requisição do Next); `can()`, Prisma,
// repositórios e banco são reais — é justamente a autoridade do servidor que
// estes testes existem para prender.
const sessaoDeTeste: { usuario: { id: string; contaId: string; perfilAcessoId: string } | null } = {
  usuario: null,
};

vi.mock("@/src/server/auth/sessao", () => ({
  exigirUsuarioAutenticado: async () => {
    if (!sessaoDeTeste.usuario) throw new Error("sessão de teste não configurada");
    return sessaoDeTeste.usuario;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { criarEmissaoAction, editarEmissaoAction } = await import("@/src/server/actions/emissao");

import {
  ERRO_SEM_PLANO_PARA_O_ATIVO,
  ERRO_TROCA_DE_PLANO_COM_PROGRESSO,
  estadoInicialAcaoEmissao,
  mensagemDeErro,
} from "@/src/server/actions/emissao-estado";

import {
  criarAtivo,
  criarEmissaoCompleta,
  criarEmpresa,
  criarItemRevisional,
  criarPlano,
  criarTipoAtivo,
  db,
  limparBanco,
} from "./setup/fixtures";

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
          setor: "Manutencao",
          dataAgendamento: null,
          dataInicio: null,
          dataFim: null,
          trocouPlano: false,
          itens: [],
          itensNovos: [],
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
          setor: "Manutencao",
          dataAgendamento: null,
          dataInicio: null,
          dataFim: null,
          trocouPlano: false,
          itens: [],
          itensNovos: [],
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

// ---------------------------------------------------------------------------
// Story 7.5 — plano derivado do ativo (AD-32) e data do servidor (AD-33)
// ---------------------------------------------------------------------------
// Contra banco REAL e pelas Server Actions, porque é exatamente aqui que a
// autoridade do servidor vive: a regra pura já está coberta em
// `emissao-servico-duracao.test.ts`, mas nada além destes testes garante que a
// Server Action a CONSULTA, que ignora o `dataEmissao` do cliente, e que uma
// emissão já gravada não é renumerada.

async function cenarioComSessao(opcoes: { nomeDaConta?: string } = {}) {
  const cenario = await criarEmissaoCompleta(opcoes);
  sessaoDeTeste.usuario = {
    id: cenario.identidade.id,
    contaId: cenario.conta.id,
    perfilAcessoId: cenario.perfil.id,
  };
  return cenario;
}

// O FormData que o modal de fato envia — sem `planoId` (o plano deixou de ser
// campo) e sem `dataEmissao`, salvo quando um teste os FORJA de propósito.
function formDeEmissao(campos: Record<string, string>) {
  const formData = new FormData();
  formData.set("setor", "Manutencao");
  formData.set("servicoCount", "0");
  for (const [nome, valor] of Object.entries(campos)) formData.set(nome, valor);
  return formData;
}

async function emissoesNovas(contaId: string, exceto: string) {
  return db.emissao.findMany({ where: { contaId, id: { not: exceto } } });
}

describe("Emissão: plano e data automáticos (Story 7.5)", () => {
  test("a data é do servidor, o ano do código sai dela e um dataEmissao forjado é ignorado", async () => {
    const cenario = await cenarioComSessao();
    const antes = Date.now();

    const estado = await criarEmissaoAction(
      estadoInicialAcaoEmissao,
      formDeEmissao({
        ativoId: cenario.ativo.id,
        responsavelId: cenario.identidade.id,
        // I/O Matrix "Data forjada": outro ano, direto no FormData. Se a action
        // voltasse a ler este campo, o código nasceria em 1999 — e uma emissão
        // real ficaria renumerada num ano que não existe na conta.
        dataEmissao: "1999-01-01",
      }),
    );
    expect(estado.ok).toBe(true);

    const [criada] = await emissoesNovas(cenario.conta.id, cenario.emissao.id);
    expect(criada.dataEmissao.getTime()).toBeGreaterThanOrEqual(antes - 5_000);
    expect(criada.dataEmissao.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(criada.ano).not.toBe(1999);
    // O ano do código e a data gravada saem do MESMO instante (Design Notes).
    expect(criada.ano).toBe(anoNoFusoDeNegocio(criada.dataEmissao));
    expect(criada.codigo).toBe(`EM-${criada.ano}-${String(criada.seq).padStart(4, "0")}`);
    // E o plano veio do ativo, sem ninguém escolher (AD-32).
    expect(criada.planoId).toBe(cenario.plano.id);
  });

  test("sem plano aplicável, recusa sem gravar nada", async () => {
    const cenario = await cenarioComSessao();
    // Único candidato arquivado — não é candidato (Boundaries): recusa como
    // "sem plano", nunca vincula a emissão a um plano fora de uso.
    await db.planoRevisional.update({
      where: { id: cenario.plano.id },
      data: { status: "Arquivado" },
    });

    const estado = await criarEmissaoAction(
      estadoInicialAcaoEmissao,
      formDeEmissao({ ativoId: cenario.ativo.id, responsavelId: cenario.identidade.id }),
    );

    expect(estado.ok).toBe(false);
    // Afere a MENSAGEM, não só o `ok` — a regra "arquivado não é candidato"
    // é guardada em DOIS lugares (o `where status: "Ativo"` de
    // `planosCandidatosDoAtivo` e o filtro de `derivarPlanoDoAtivo`), então
    // só `ok === false` passaria mesmo com a derivação aceitando arquivado:
    // a recusa viria de outro ponto, por outro motivo. Verificado por mutação.
    expect(mensagemDeErro(estado.error)).toBe(ERRO_SEM_PLANO_PARA_O_ATIVO);
    expect(await emissoesNovas(cenario.conta.id, cenario.emissao.id)).toHaveLength(0);
  });

  // Frente A: o terceiro nível de vínculo tem de chegar até a EMISSÃO, não só
  // até o cadastro. Sem isso o plano por empresa existiria na listagem e seria
  // invisível onde importa.
  test("um plano da empresa proprietária é candidato na emissão", async () => {
    const cenario = await cenarioComSessao();
    const empresa = await criarEmpresa(cenario.conta.id);
    await db.ativo.update({
      where: { id: cenario.ativo.id },
      data: { empresaId: empresa.id },
    });
    // Arquivar o plano-por-ativo deixa o da empresa como único candidato: se
    // ele NÃO fosse enxergado, a emissão cairia em "sem plano aplicável".
    await db.planoRevisional.update({
      where: { id: cenario.plano.id },
      data: { status: "Arquivado" },
    });
    const planoDaEmpresa = await db.planoRevisional.create({
      data: {
        contaId: cenario.conta.id,
        nome: "Plano da empresa",
        empresaId: empresa.id,
        responsavelId: cenario.identidade.id,
        itens: { create: [{ itemRevisionalId: cenario.item.id }] },
      },
    });

    const estado = await criarEmissaoAction(
      estadoInicialAcaoEmissao,
      formDeEmissao({ ativoId: cenario.ativo.id, responsavelId: cenario.identidade.id }),
    );

    expect(estado.ok).toBe(true);
    const [criada] = await emissoesNovas(cenario.conta.id, cenario.emissao.id);
    expect(criada.planoId).toBe(planoDaEmpresa.id);
  });

  // Frente A — itens AVULSOS na aba Itens. O botão "buscar itens do plano" e
  // o seletor avulso enviam a MESMA coisa (`itemAvulso-{id}`), então os
  // testes abaixo cobrem os dois de uma vez.
  describe("itens avulsos", () => {
    test("um item fora do plano entra na emissão, com o valor esperado do próprio item", async () => {
      const cenario = await cenarioComSessao();
      const avulso = await criarItemRevisional(cenario.conta.id, { nome: "Troca de pneu" });

      const estado = await criarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          ativoId: cenario.ativo.id,
          responsavelId: cenario.identidade.id,
          [`itemAvulso-${avulso.id}`]: "1",
        }),
      );

      expect(estado.ok).toBe(true);
      const [criada] = await emissoesNovas(cenario.conta.id, cenario.emissao.id);
      const itens = await db.itemExecutadoEmissao.findMany({ where: { emissaoId: criada.id } });

      // O item do plano E o avulso — o avulso ACRESCENTA, nunca substitui.
      expect(itens.map((item) => item.itemRevisionalId).sort()).toEqual(
        [cenario.item.id, avulso.id].sort(),
      );
      // Sem PlanoItemRevisional não há override: o snapshot vem do padrão do
      // próprio item (100 horas, da fixture).
      const gravado = itens.find((item) => item.itemRevisionalId === avulso.id)!;
      expect(gravado.valorEsperadoHoras).toBe(100);
    });

    // A emissão tem @@unique([emissaoId, itemRevisionalId]): sem o filtro de
    // duplicata a gravação estouraria, e o usuário veria um erro genérico por
    // ter clicado duas vezes no botão.
    test("avulso que repete um item do plano é ignorado, sem estourar", async () => {
      const cenario = await cenarioComSessao();

      const estado = await criarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          ativoId: cenario.ativo.id,
          responsavelId: cenario.identidade.id,
          [`itemAvulso-${cenario.item.id}`]: "1",
        }),
      );

      expect(estado.ok).toBe(true);
      const [criada] = await emissoesNovas(cenario.conta.id, cenario.emissao.id);
      const itens = await db.itemExecutadoEmissao.findMany({ where: { emissaoId: criada.id } });
      expect(itens).toHaveLength(1);
    });

    test("avulso de OUTRA conta é ignorado e não entra (AD-1)", async () => {
      const cenario = await cenarioComSessao();
      const outra = await criarEmissaoCompleta({ nomeDaConta: "Outra conta" });
      const itemAlheio = await criarItemRevisional(outra.conta.id);

      const estado = await criarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          ativoId: cenario.ativo.id,
          responsavelId: cenario.identidade.id,
          [`itemAvulso-${itemAlheio.id}`]: "1",
        }),
      );

      expect(estado.ok).toBe(true);
      const [criada] = await emissoesNovas(cenario.conta.id, cenario.emissao.id);
      const itens = await db.itemExecutadoEmissao.findMany({ where: { emissaoId: criada.id } });
      expect(itens.map((item) => item.itemRevisionalId)).toEqual([cenario.item.id]);
    });

    // O caso que mais importa no dia a dia: acrescentar um item a uma emissão
    // JÁ EM ANDAMENTO, sem trocar o plano. Este caminho é update-in-place, e
    // o avulso tem de virar linha NOVA sem tocar no progresso das existentes.
    test("avulso numa edição sem troca de plano cria a linha e preserva o progresso", async () => {
      const cenario = await cenarioComSessao();
      const avulso = await criarItemRevisional(cenario.conta.id, { nome: "Troca de pneu" });
      const criacao = await criarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({ ativoId: cenario.ativo.id, responsavelId: cenario.identidade.id }),
      );
      expect(criacao.ok).toBe(true);
      const [criada] = await emissoesNovas(cenario.conta.id, cenario.emissao.id);

      const itemGravado = await db.itemExecutadoEmissao.findFirstOrThrow({
        where: { emissaoId: criada.id },
      });
      await db.itemExecutadoEmissao.update({
        where: { id: itemGravado.id },
        data: { executado: true, observacao: "feito na segunda" },
      });
      const recarregada = await db.emissao.findUniqueOrThrow({ where: { id: criada.id } });

      const estado = await editarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          emissaoId: criada.id,
          updatedAt: recarregada.updatedAt.toISOString(),
          ativoId: cenario.ativo.id,
          responsavelId: cenario.identidade.id,
          [`itemExecutado-${cenario.item.id}`]: "on",
          [`itemObs-${cenario.item.id}`]: "feito na segunda",
          [`itemAvulso-${avulso.id}`]: "1",
        }),
      );

      expect(estado.ok).toBe(true);
      const itens = await db.itemExecutadoEmissao.findMany({ where: { emissaoId: criada.id } });
      expect(itens).toHaveLength(2);

      // O item antigo manteve o progresso — nada de delete+recreate aqui.
      const antigo = itens.find((item) => item.itemRevisionalId === cenario.item.id)!;
      expect(antigo.executado).toBe(true);
      expect(antigo.observacao).toBe("feito na segunda");
      // E o novo nasceu limpo.
      const novo = itens.find((item) => item.itemRevisionalId === avulso.id)!;
      expect(novo.executado).toBe(false);
      expect(novo.valorEsperadoHoras).toBe(100);
    });
  });

  describe("escolha do plano entre os candidatos (Frente A)", () => {
    async function cenarioAmbiguo() {
      const cenario = await cenarioComSessao();
      const segundo = await criarPlano(
        cenario.conta.id,
        cenario.ativo.id,
        cenario.identidade.id,
        { itemRevisionalId: cenario.item.id },
      );
      return { ...cenario, segundoPlano: segundo };
    }

    // Frente A inverteu esta regra: dois planos cobrindo o mesmo ativo eram
    // RECUSA ("escolha qual usar"), e agora são uma lista com uma sugestão.
    // Sem escolha no formulário, o servidor grava a sugestão — o primeiro na
    // ordem (nível, depois nome) — em vez de barrar a emissão.
    test("dois planos para o mesmo ativo: grava a sugestão, sem recusar", async () => {
      const cenario = await cenarioAmbiguo();

      const estado = await criarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({ ativoId: cenario.ativo.id, responsavelId: cenario.identidade.id }),
      );

      expect(estado.ok).toBe(true);
      const [criada] = await emissoesNovas(cenario.conta.id, cenario.emissao.id);

      // Os dois estão no MESMO nível (ambos miram o ativo), então quem decide
      // é o nome — e o teste calcula o esperado em vez de fixar um id, para
      // não depender da ordem em que as fixtures nasceram.
      const esperado = [cenario.plano, cenario.segundoPlano].sort((a, b) =>
        a.nome.localeCompare(b.nome, "pt-BR"),
      )[0];
      expect(criada.planoId).toBe(esperado.id);
    });

    test("com escolha explícita entre os candidatos, grava o escolhido", async () => {
      const cenario = await cenarioAmbiguo();

      const estado = await criarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          ativoId: cenario.ativo.id,
          responsavelId: cenario.identidade.id,
          planoId: cenario.segundoPlano.id,
        }),
      );

      expect(estado.ok).toBe(true);
      const [criada] = await emissoesNovas(cenario.conta.id, cenario.emissao.id);
      expect(criada.planoId).toBe(cenario.segundoPlano.id);
    });

    // O espelho do caso acima, e a regra que a Frente A INVERTEU: antes, com
    // um único candidato, o `planoId` do cliente era ignorado — a escolha só
    // tinha voz na ambiguidade. Agora ela sempre tem voz, desde que aponte
    // para um candidato real. Um único candidato não muda isso: escolher o
    // próprio candidato é válido e grava ele.
    test("com um único candidato, escolher esse mesmo candidato grava normal", async () => {
      const cenario = await cenarioComSessao();

      const estado = await criarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          ativoId: cenario.ativo.id,
          responsavelId: cenario.identidade.id,
          planoId: cenario.plano.id,
        }),
      );

      expect(estado.ok).toBe(true);
      const [criada] = await emissoesNovas(cenario.conta.id, cenario.emissao.id);
      expect(criada.planoId).toBe(cenario.plano.id);
    });

    // I/O Matrix "Escolha forjada": um plano REAL, da própria conta, `Ativo` —
    // e que simplesmente não cobre este ativo. É o caso que um `buscarPlano`
    // ingênuo aceitaria, porque o plano existe.
    test("planoId de fora dos candidatos é recusado", async () => {
      const cenario = await cenarioAmbiguo();
      const outroTipo = await criarTipoAtivo(cenario.conta.id);
      const outroAtivo = await criarAtivo(cenario.conta.id, outroTipo.id);
      const planoDeOutroAtivo = await criarPlano(
        cenario.conta.id,
        outroAtivo.id,
        cenario.identidade.id,
        { itemRevisionalId: cenario.item.id },
      );

      const estado = await criarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          ativoId: cenario.ativo.id,
          responsavelId: cenario.identidade.id,
          planoId: planoDeOutroAtivo.id,
        }),
      );

      expect(estado.ok).toBe(false);
      expect(await emissoesNovas(cenario.conta.id, cenario.emissao.id)).toHaveLength(0);
    });
  });

  describe("edição", () => {
    // Um segundo ativo, de outro tipo, com plano próprio — trocar o ativo da
    // emissão para ele MUDA o plano derivado, que é o gatilho desta regra.
    async function comSegundoAtivo(cenario: Awaited<ReturnType<typeof cenarioComSessao>>) {
      const tipo = await criarTipoAtivo(cenario.conta.id);
      const ativo = await criarAtivo(cenario.conta.id, tipo.id);
      const plano = await criarPlano(cenario.conta.id, ativo.id, cenario.identidade.id, {
        itemRevisionalId: cenario.item.id,
      });
      return { ativo, plano };
    }

    async function criarPelaAction(
      cenario: Awaited<ReturnType<typeof cenarioComSessao>>,
      extra: Record<string, string> = {},
    ) {
      const estado = await criarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          ativoId: cenario.ativo.id,
          responsavelId: cenario.identidade.id,
          ...extra,
        }),
      );
      expect(estado.ok).toBe(true);
      const [criada] = await emissoesNovas(cenario.conta.id, cenario.emissao.id);
      return criada;
    }

    test("sem progresso, trocar o ativo re-deriva o plano — e nada é renumerado", async () => {
      const cenario = await cenarioComSessao();
      const segundo = await comSegundoAtivo(cenario);
      const criada = await criarPelaAction(cenario);

      const estado = await editarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          emissaoId: criada.id,
          updatedAt: criada.updatedAt.toISOString(),
          ativoId: segundo.ativo.id,
          responsavelId: cenario.identidade.id,
          // I/O Matrix "Data na edição": mesmo forjada, não renumera nada.
          dataEmissao: "1999-01-01",
        }),
      );
      expect(estado.ok).toBe(true);

      const relida = await db.emissao.findUniqueOrThrow({ where: { id: criada.id } });
      expect(relida.planoId).toBe(segundo.plano.id);
      // AC: código, ano, sequencial e data continuam EXATAMENTE os mesmos.
      expect(relida.codigo).toBe(criada.codigo);
      expect(relida.ano).toBe(criada.ano);
      expect(relida.seq).toBe(criada.seq);
      expect(relida.dataEmissao.toISOString()).toBe(criada.dataEmissao.toISOString());
    });

    test("com progresso gravado, trocar o ativo é recusado e o snapshot fica intacto", async () => {
      const cenario = await cenarioComSessao();
      const segundo = await comSegundoAtivo(cenario);
      // O item nasce executado: é progresso GRAVADO já na criação.
      const criada = await criarPelaAction(cenario, {
        [`itemExecutado-${cenario.item.id}`]: "on",
      });
      const itensAntes = await db.itemExecutadoEmissao.findMany({
        where: { emissaoId: criada.id },
      });
      expect(itensAntes.some((item) => item.executado)).toBe(true);

      const estado = await editarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          emissaoId: criada.id,
          updatedAt: criada.updatedAt.toISOString(),
          ativoId: segundo.ativo.id,
          responsavelId: cenario.identidade.id,
          [`itemExecutado-${cenario.item.id}`]: "on",
        }),
      );

      expect(estado.ok).toBe(false);
      // O CAMPO importa tanto quanto a recusa: é por `ativoId` que a mensagem
      // acha onde aparecer na tela. Trocar a chave deixaria o erro invisível.
      expect(estado.error).toEqual([
        { field: "planoId", message: ERRO_TROCA_DE_PLANO_COM_PROGRESSO },
      ]);
      const relida = await db.emissao.findUniqueOrThrow({ where: { id: criada.id } });
      // Nada mudou: nem o ativo, nem o plano, nem as linhas de item — a recusa
      // precede a escrita (AD-9), nunca é um delete+recreate revertido pela
      // metade.
      expect(relida.ativoId).toBe(cenario.ativo.id);
      expect(relida.planoId).toBe(cenario.plano.id);
      const itensDepois = await db.itemExecutadoEmissao.findMany({
        where: { emissaoId: criada.id },
      });
      expect(itensDepois.map((item) => item.id).sort()).toEqual(
        itensAntes.map((item) => item.id).sort(),
      );
      expect(itensDepois.every((item) => item.executado)).toBe(true);
    });

    // O contraponto: com progresso, mas SEM troca de ativo, a edição salva
    // normalmente. Sem este teste, uma guarda grosseira demais ("emissão com
    // progresso não edita") passaria nos dois testes acima.
    test("com progresso e sem trocar o ativo, salva normalmente", async () => {
      const cenario = await cenarioComSessao();
      const criada = await criarPelaAction(cenario, {
        [`itemExecutado-${cenario.item.id}`]: "on",
      });

      const estado = await editarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          emissaoId: criada.id,
          updatedAt: criada.updatedAt.toISOString(),
          ativoId: cenario.ativo.id,
          responsavelId: cenario.identidade.id,
          setor: "Producao",
          [`itemExecutado-${cenario.item.id}`]: "on",
        }),
      );

      expect(estado.ok).toBe(true);
      const relida = await db.emissao.findUniqueOrThrow({ where: { id: criada.id } });
      expect(relida.setor).toBe("Producao");
      expect(relida.planoId).toBe(cenario.plano.id);
      expect(relida.dataEmissao.toISOString()).toBe(criada.dataEmissao.toISOString());
    });

    // O outro tipo de progresso: NENHUM item executado, só um lançamento de
    // serviço. A recusa depende de `emissaoAtual.servicos` chegar carregado
    // pelo include de `buscarEmissao` — um include que mudasse deixaria este
    // caminho apagar os lançamentos em silêncio.
    test("com progresso APENAS de serviço, trocar o ativo é recusado", async () => {
      const cenario = await cenarioComSessao();
      const segundo = await comSegundoAtivo(cenario);
      const criada = await criarPelaAction(cenario, {
        servicoCount: "1",
        "servico-0-pessoaId": cenario.pessoa.id,
        "servico-0-itemRevisionalId": cenario.item.id,
        "servico-0-modo": "Duracao",
        "servico-0-horas": "2:00",
      });
      expect(await db.servicoEmissao.count({ where: { emissaoId: criada.id } })).toBe(1);
      expect(
        await db.itemExecutadoEmissao.count({ where: { emissaoId: criada.id, executado: true } }),
      ).toBe(0);

      const estado = await editarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          emissaoId: criada.id,
          updatedAt: criada.updatedAt.toISOString(),
          ativoId: segundo.ativo.id,
          responsavelId: cenario.identidade.id,
          servicoCount: "1",
          "servico-0-pessoaId": cenario.pessoa.id,
          "servico-0-itemRevisionalId": cenario.item.id,
          "servico-0-modo": "Duracao",
          "servico-0-horas": "2:00",
        }),
      );

      expect(estado.ok).toBe(false);
      expect(estado.error).toEqual([
        { field: "planoId", message: ERRO_TROCA_DE_PLANO_COM_PROGRESSO },
      ]);
      const relida = await db.emissao.findUniqueOrThrow({ where: { id: criada.id } });
      expect(relida.ativoId).toBe(cenario.ativo.id);
      expect(await db.servicoEmissao.count({ where: { emissaoId: criada.id } })).toBe(1);
    });

    // Os dois casos em que a DERIVAÇÃO deixaria de resolver depois da criação.
    // Com o MESMO ativo ela nem é consultada: o plano gravado é preservado e a
    // emissão continua editável. Se a derivação voltasse a rodar incondicional,
    // a emissão ficaria PERMANENTEMENTE ineditável — nem setor, nem
    // responsável, nem datas, nem itens, nem serviços.
    // O RISCO NOVO da Frente A: antes, o plano só mudava se o ativo mudasse,
    // e era isso que protegia o progresso. Com o plano escolhível direto,
    // existe um segundo caminho de troca — e a trava precisa valer nele
    // também, senão trocar só o plano apagaria em silêncio execução, medição,
    // observação e o vínculo dos lançamentos.
    test("trocar SÓ o plano, com progresso gravado, é recusado", async () => {
      const cenario = await cenarioComSessao();
      const segundoPlano = await criarPlano(
        cenario.conta.id,
        cenario.ativo.id,
        cenario.identidade.id,
        { nome: "Zebra (segundo plano)", itemRevisionalId: cenario.item.id },
      );
      const criada = await criarPelaAction(cenario);

      // Progresso real: um item executado na emissão recém-criada.
      const itemGravado = await db.itemExecutadoEmissao.findFirstOrThrow({
        where: { emissaoId: criada.id },
      });
      await db.itemExecutadoEmissao.update({
        where: { id: itemGravado.id },
        data: { executado: true },
      });
      const recarregada = await db.emissao.findUniqueOrThrow({ where: { id: criada.id } });

      const estado = await editarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          emissaoId: criada.id,
          updatedAt: recarregada.updatedAt.toISOString(),
          // MESMO ativo — só o plano muda.
          ativoId: cenario.ativo.id,
          planoId: segundoPlano.id,
          responsavelId: cenario.identidade.id,
        }),
      );

      expect(estado.ok).toBe(false);
      expect(mensagemDeErro(estado.error)).toBe(ERRO_TROCA_DE_PLANO_COM_PROGRESSO);
      // O plano gravado não se mexeu, e o progresso continua lá.
      const depois = await db.emissao.findUniqueOrThrow({
        where: { id: criada.id },
        include: { itens: true },
      });
      expect(depois.planoId).toBe(criada.planoId);
      expect(depois.itens.some((item) => item.executado)).toBe(true);
    });

    test("trocar só o plano, SEM progresso, troca o plano e re-snapshota os itens", async () => {
      const cenario = await cenarioComSessao();
      const segundoPlano = await criarPlano(
        cenario.conta.id,
        cenario.ativo.id,
        cenario.identidade.id,
        { nome: "Zebra (segundo plano)", itemRevisionalId: cenario.item.id },
      );
      const criada = await criarPelaAction(cenario);

      const estado = await editarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          emissaoId: criada.id,
          updatedAt: criada.updatedAt.toISOString(),
          ativoId: cenario.ativo.id,
          planoId: segundoPlano.id,
          responsavelId: cenario.identidade.id,
        }),
      );

      expect(estado.ok).toBe(true);
      const depois = await db.emissao.findUniqueOrThrow({ where: { id: criada.id } });
      expect(depois.planoId).toBe(segundoPlano.id);
    });

    test("plano arquivado depois da criação não impede editar com o mesmo ativo", async () => {
      const cenario = await cenarioComSessao();
      const criada = await criarPelaAction(cenario);
      await db.planoRevisional.update({
        where: { id: cenario.plano.id },
        data: { status: "Arquivado" },
      });

      const estado = await editarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          emissaoId: criada.id,
          updatedAt: criada.updatedAt.toISOString(),
          ativoId: cenario.ativo.id,
          responsavelId: cenario.identidade.id,
          setor: "Producao",
        }),
      );

      expect(estado.ok).toBe(true);
      const relida = await db.emissao.findUniqueOrThrow({ where: { id: criada.id } });
      expect(relida.setor).toBe("Producao");
      expect(relida.planoId).toBe(cenario.plano.id);
    });

    test("segundo plano cobrindo o mesmo ativo não impede editar com o mesmo ativo", async () => {
      const cenario = await cenarioComSessao();
      const criada = await criarPelaAction(cenario);
      // Ambiguidade criada DEPOIS: na criação havia um candidato só.
      await criarPlano(cenario.conta.id, cenario.ativo.id, cenario.identidade.id, {
        itemRevisionalId: cenario.item.id,
      });

      const estado = await editarEmissaoAction(
        estadoInicialAcaoEmissao,
        formDeEmissao({
          emissaoId: criada.id,
          updatedAt: criada.updatedAt.toISOString(),
          ativoId: cenario.ativo.id,
          responsavelId: cenario.identidade.id,
          setor: "Producao",
        }),
      );

      expect(estado.ok).toBe(true);
      const relida = await db.emissao.findUniqueOrThrow({ where: { id: criada.id } });
      expect(relida.setor).toBe("Producao");
      expect(relida.planoId).toBe(cenario.plano.id);
    });
  });

  // AD-33 — o ANO do código sai do fuso de NEGÓCIO (America/Sao_Paulo), não do
  // fuso do processo (UTC na Vercel). 31/dez 21h em Brasília já é 1º/jan em
  // UTC: `getFullYear()` no processo daria o ano seguinte, e nada renumera
  // depois — o código é a identidade do documento.
  describe("ano do código na virada do ano", () => {
    test("um instante de 31/dez 21h BRT (já 1º/jan em UTC) rende o ano de Brasília", () => {
      const virada = new Date("2026-01-01T00:30:00.000Z"); // 31/12/2025 21:30 BRT
      expect(anoNoFusoDeNegocio(virada)).toBe(2025);
      expect(virada.getUTCFullYear()).toBe(2026);
    });

    test("fora da virada, o ano é o mesmo dos dois lados", () => {
      expect(anoNoFusoDeNegocio(new Date("2026-06-15T12:00:00.000Z"))).toBe(2026);
    });
  });
});
