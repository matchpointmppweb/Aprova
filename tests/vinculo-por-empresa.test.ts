import { beforeEach, describe, expect, test, vi } from "vitest";

import { validarVinculoXor } from "@/src/server/actions/plano-estado";
import { resolverAtivosDoPlano } from "@/src/server/repositories/plano";

// Mesmo dublê de sessão de servico-emissao.test.ts: só a SESSÃO é falsa, o
// resto (can(), Prisma, repositórios, banco) é real.
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

const { criarAtivoAction } = await import("@/src/server/actions/ativo");

import {
  criarAmbiente,
  criarAtivo,
  criarEmpresa,
  criarItemRevisional,
  criarTipoAtivo,
  db,
  limparBanco,
} from "./setup/fixtures";

beforeEach(limparBanco);

// Frente A — a Empresa vira o terceiro lado do vínculo de plano, e a dona do
// ativo. O que estes testes prendem é o que a aplicação sozinha NÃO prende:
// a CHECK (que o Prisma não modela e a checagem de deriva não enxerga) e a
// expansão de cobertura do plano-por-empresa.

describe("CHECK planos_revisionais_vinculo_exclusivo", () => {
  // Escrita pelo client dos testes, NÃO pela Server Action: aqui a validação
  // da aplicação não é a rede de segurança — a CHECK é o que está sob teste.
  async function tentarGravar(
    contaId: string,
    responsavelId: string,
    vinculos: {
      ativoId?: string | null;
      tipoAtivoId?: string | null;
      empresaId?: string | null;
    },
  ) {
    return db.planoRevisional.create({
      data: {
        contaId,
        nome: `Plano ${Math.random()}`,
        responsavelId,
        ativoId: vinculos.ativoId ?? null,
        tipoAtivoId: vinculos.tipoAtivoId ?? null,
        empresaId: vinculos.empresaId ?? null,
      },
    });
  }

  async function cenario() {
    const ambiente = await criarAmbiente();
    const tipo = await criarTipoAtivo(ambiente.conta.id);
    const ativo = await criarAtivo(ambiente.conta.id, tipo.id);
    const empresa = await criarEmpresa(ambiente.conta.id);
    return { ambiente, tipo, ativo, empresa };
  }

  test("nenhum vínculo é recusado", async () => {
    const { ambiente } = await cenario();
    await expect(tentarGravar(ambiente.conta.id, ambiente.identidade.id, {})).rejects.toThrow();
  });

  test("ativo + tipo é recusado", async () => {
    const { ambiente, tipo, ativo } = await cenario();
    await expect(
      tentarGravar(ambiente.conta.id, ambiente.identidade.id, {
        ativoId: ativo.id,
        tipoAtivoId: tipo.id,
      }),
    ).rejects.toThrow();
  });

  test("ativo + empresa é recusado", async () => {
    const { ambiente, ativo, empresa } = await cenario();
    await expect(
      tentarGravar(ambiente.conta.id, ambiente.identidade.id, {
        ativoId: ativo.id,
        empresaId: empresa.id,
      }),
    ).rejects.toThrow();
  });

  test("tipo + empresa é recusado", async () => {
    const { ambiente, tipo, empresa } = await cenario();
    await expect(
      tentarGravar(ambiente.conta.id, ambiente.identidade.id, {
        tipoAtivoId: tipo.id,
        empresaId: empresa.id,
      }),
    ).rejects.toThrow();
  });

  test("os três juntos são recusados", async () => {
    const { ambiente, tipo, ativo, empresa } = await cenario();
    await expect(
      tentarGravar(ambiente.conta.id, ambiente.identidade.id, {
        ativoId: ativo.id,
        tipoAtivoId: tipo.id,
        empresaId: empresa.id,
      }),
    ).rejects.toThrow();
  });

  test("exatamente um vínculo — inclusive o novo, por empresa — é aceito", async () => {
    const { ambiente, tipo, ativo, empresa } = await cenario();

    // Os três caminhos válidos gravam. O terceiro é o que a story acrescenta:
    // se a CHECK tivesse sido escrita só para as duas colunas antigas, ele
    // seria recusado e a funcionalidade inteira estaria morta no banco.
    await expect(
      tentarGravar(ambiente.conta.id, ambiente.identidade.id, { ativoId: ativo.id }),
    ).resolves.toBeTruthy();
    await expect(
      tentarGravar(ambiente.conta.id, ambiente.identidade.id, { tipoAtivoId: tipo.id }),
    ).resolves.toBeTruthy();
    await expect(
      tentarGravar(ambiente.conta.id, ambiente.identidade.id, { empresaId: empresa.id }),
    ).resolves.toBeTruthy();
  });
});

describe("validarVinculoXor", () => {
  test("exatamente um vínculo não gera erro", () => {
    expect(validarVinculoXor("a1", null, null)).toEqual([]);
    expect(validarVinculoXor(null, "t1", null)).toEqual([]);
    expect(validarVinculoXor(null, null, "e1")).toEqual([]);
  });

  test("nenhum, dois ou três vínculos geram erro de campo", () => {
    const combinacoes: [string | null, string | null, string | null][] = [
      [null, null, null],
      ["a1", "t1", null],
      ["a1", null, "e1"],
      [null, "t1", "e1"],
      ["a1", "t1", "e1"],
    ];

    for (const [ativoId, tipoAtivoId, empresaId] of combinacoes) {
      const erros = validarVinculoXor(ativoId, tipoAtivoId, empresaId);
      expect(erros).toHaveLength(1);
      expect(erros[0].field).toBe("vinculo");
    }
  });
});

describe("resolverAtivosDoPlano com plano por empresa", () => {
  test("cobre os ativos da empresa, e só eles", async () => {
    const ambiente = await criarAmbiente();
    const tipo = await criarTipoAtivo(ambiente.conta.id);
    const item = await criarItemRevisional(ambiente.conta.id);

    const empresa = await criarEmpresa(ambiente.conta.id);
    const outraEmpresa = await criarEmpresa(ambiente.conta.id);

    const daEmpresa1 = await criarAtivo(ambiente.conta.id, tipo.id, { empresaId: empresa.id });
    const daEmpresa2 = await criarAtivo(ambiente.conta.id, tipo.id, { empresaId: empresa.id });
    // Dois vizinhos que NÃO podem entrar: um de outra empresa e um sem dona.
    // São o que distingue "cobre a empresa" de "cobre todo mundo" — sem eles
    // um `where` sem filtro passaria no teste.
    const daOutraEmpresa = await criarAtivo(ambiente.conta.id, tipo.id, {
      empresaId: outraEmpresa.id,
    });
    await criarAtivo(ambiente.conta.id, tipo.id);

    const plano = await db.planoRevisional.create({
      data: {
        contaId: ambiente.conta.id,
        nome: "Plano da empresa",
        empresaId: empresa.id,
        responsavelId: ambiente.identidade.id,
        itens: { create: [{ itemRevisionalId: item.id }] },
      },
    });
    // Um SEGUNDO plano por empresa é o que torna este teste discriminante, e
    // não é zelo: com um plano só, a lista que o repositório busca já é
    // exatamente a resposta esperada, e um lookup que ignorasse o agrupamento
    // por empresa passaria despercebido. Verificado por mutação — sem este
    // segundo plano o defeito não era pego.
    const planoDaOutra = await db.planoRevisional.create({
      data: {
        contaId: ambiente.conta.id,
        nome: "Plano da outra empresa",
        empresaId: outraEmpresa.id,
        responsavelId: ambiente.identidade.id,
        itens: { create: [{ itemRevisionalId: item.id }] },
      },
    });

    const resolucoes = await resolverAtivosDoPlano(ambiente.conta.id);
    const cobertos = resolucoes
      .filter((resolucao) => resolucao.planoId === plano.id)
      .map((resolucao) => resolucao.ativoId)
      .sort();

    expect(cobertos).toEqual([daEmpresa1.id, daEmpresa2.id].sort());

    // E o plano da outra empresa enxerga só o ativo DELA — o cruzamento é o
    // que prova que cada plano lê o próprio balde.
    const cobertosDaOutra = resolucoes
      .filter((resolucao) => resolucao.planoId === planoDaOutra.id)
      .map((resolucao) => resolucao.ativoId);

    expect(cobertosDaOutra).toEqual([daOutraEmpresa.id]);
  });

  test("ativo inativo da empresa não é coberto", async () => {
    const ambiente = await criarAmbiente();
    const tipo = await criarTipoAtivo(ambiente.conta.id);
    const item = await criarItemRevisional(ambiente.conta.id);
    const empresa = await criarEmpresa(ambiente.conta.id);

    const inativo = await criarAtivo(ambiente.conta.id, tipo.id, { empresaId: empresa.id });
    await db.ativo.update({ where: { id: inativo.id }, data: { status: "Inativo" } });

    const plano = await db.planoRevisional.create({
      data: {
        contaId: ambiente.conta.id,
        nome: "Plano da empresa",
        empresaId: empresa.id,
        responsavelId: ambiente.identidade.id,
        itens: { create: [{ itemRevisionalId: item.id }] },
      },
    });

    const resolucoes = await resolverAtivosDoPlano(ambiente.conta.id);
    expect(resolucoes.filter((resolucao) => resolucao.planoId === plano.id)).toHaveLength(0);
  });
});

describe("empresa proprietária do ativo (AD-1)", () => {
  test("uma empresa de OUTRA conta é recusada e nada é gravado", async () => {
    const minha = await criarAmbiente();
    const outra = await criarAmbiente({ nomeDaConta: "Outra conta" });
    const tipo = await criarTipoAtivo(minha.conta.id);
    const empresaAlheia = await criarEmpresa(outra.conta.id);

    sessaoDeTeste.usuario = {
      id: minha.identidade.id,
      contaId: minha.conta.id,
      perfilAcessoId: minha.perfil.id,
    };

    const formData = new FormData();
    formData.set("nome", "Caminhão novo");
    formData.set("tipoAtivoId", tipo.id);
    formData.set("localizacao", "Pátio");
    formData.set("status", "Ativo");
    formData.set("empresaId", empresaAlheia.id);

    const estado = await criarAtivoAction({ ok: false }, formData);

    expect(estado.ok).toBe(false);
    expect(await db.ativo.count({ where: { contaId: minha.conta.id } })).toBe(0);
  });

  test("sem proprietária é válido — o ativo grava com empresaId nulo", async () => {
    const minha = await criarAmbiente();
    const tipo = await criarTipoAtivo(minha.conta.id);

    sessaoDeTeste.usuario = {
      id: minha.identidade.id,
      contaId: minha.conta.id,
      perfilAcessoId: minha.perfil.id,
    };

    const formData = new FormData();
    formData.set("nome", "Caminhão sem dona");
    formData.set("tipoAtivoId", tipo.id);
    formData.set("localizacao", "Pátio");
    formData.set("status", "Ativo");
    formData.set("empresaId", "");

    const estado = await criarAtivoAction({ ok: false }, formData);

    expect(estado.ok).toBe(true);
    const gravado = await db.ativo.findFirstOrThrow({ where: { contaId: minha.conta.id } });
    expect(gravado.empresaId).toBeNull();
  });
});
