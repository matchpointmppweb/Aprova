import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  opcoesSelecionaveis,
  validarEscolha,
  type MensagensDeEscolha,
} from "@/src/lib/selecionavel";

const sessaoDeTeste: {
  usuario: { id: string; contaId: string; perfilAcessoId: string } | null;
} = { usuario: null };

vi.mock("@/src/server/auth/sessao", () => ({
  exigirUsuarioAutenticado: async () => {
    if (!sessaoDeTeste.usuario) throw new Error("sessão de teste não configurada");
    return sessaoDeTeste.usuario;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { criarEmissaoAction, editarEmissaoAction } = await import("@/src/server/actions/emissao");
const { editarPlanoAction } = await import("@/src/server/actions/plano");

import { criarEmissaoCompleta, db, limparBanco } from "./setup/fixtures";

beforeEach(limparBanco);

// Diferido da Story 4.1, fechado em 29-10-2026: `referenciasValidas` conferia
// só o PERTENCIMENTO à conta, nunca o status. A tela escondia o ativo
// Vendido e o item Arquivado, mas tela não é defesa — uma requisição forjada
// criava emissão apontando para eles.
//
// A regra virou um módulo só (src/lib/selecionavel.ts) porque a mesma falta
// já tinha aparecido em três lugares; manter cópias é o que fez a terceira
// nascer incompleta.

const MENSAGENS: MensagensDeEscolha = {
  field: "ativoId",
  invalido: "inválido",
  indisponivel: "indisponível",
};

describe("a regra compartilhada", () => {
  const ATIVO = { id: "a", status: "Ativo" };
  const VENDIDO = { id: "v", status: "Vendido" };
  const TODOS = [ATIVO, VENDIDO];

  test("oferece só o que está Ativo", () => {
    expect(opcoesSelecionaveis(TODOS, null).map((i) => i.id)).toEqual(["a"]);
  });

  test("mantém o que JÁ está gravado, mesmo fora de circulação", () => {
    expect(opcoesSelecionaveis(TODOS, "v").map((i) => i.id)).toEqual(["a", "v"]);
  });

  test("quem não é da conta é 'inválido', não 'indisponível'", () => {
    // Mensagens diferentes de propósito: dizer "está arquivado" sobre um id
    // de outra conta confirmaria que ele existe em algum lugar (AD-1).
    expect(validarEscolha(TODOS, "de-outra-conta", null, MENSAGENS)[0].message).toBe("inválido");
  });

  test("o que saiu de circulação é recusado com mensagem acionável", () => {
    expect(validarEscolha(TODOS, "v", null, MENSAGENS)[0].message).toBe("indisponível");
  });

  test("mas o que já estava gravado continua aceito", () => {
    expect(validarEscolha(TODOS, "v", "v", MENSAGENS)).toEqual([]);
  });

  test("TROCAR para outro indisponível é recusado", () => {
    // Sem isto, bastaria um registro antigo qualquer para destravar todos os
    // inativos.
    const outro = { id: "v2", status: "Vendido" };
    expect(validarEscolha([...TODOS, outro], "v2", "v", MENSAGENS)).toHaveLength(1);
  });

  test("id vazio não é erro aqui — é campo obrigatório, de outra validação", () => {
    expect(validarEscolha(TODOS, "", null, MENSAGENS)).toEqual([]);
  });
});

async function cenario() {
  const c = await criarEmissaoCompleta();
  sessaoDeTeste.usuario = {
    id: c.identidade.id,
    contaId: c.conta.id,
    perfilAcessoId: c.perfil.id,
  };
  return c;
}

describe("emissão: status do ativo e do item", () => {
  test("criar com ativo VENDIDO é recusado e nada é gravado", async () => {
    const c = await cenario();
    await db.ativo.update({ where: { id: c.ativo.id }, data: { status: "Vendido" } });

    const antes = await db.emissao.count({ where: { contaId: c.conta.id } });
    const formData = new FormData();
    formData.set("ativoId", c.ativo.id);
    formData.set("responsavelId", c.identidade.id);
    formData.set("setor", "Manutencao");

    const estado = await criarEmissaoAction({ ok: false }, formData);

    expect(estado.ok).toBe(false);
    expect(await db.emissao.count({ where: { contaId: c.conta.id } })).toBe(antes);
  });

  test("criar com ativo BLOQUEADO também é recusado", async () => {
    // O vizinho que distingue a regra de um "status !== Vendido": são quatro
    // status no enum, e só um deles autoriza.
    const c = await cenario();
    await db.ativo.update({ where: { id: c.ativo.id }, data: { status: "Bloqueado" } });

    const formData = new FormData();
    formData.set("ativoId", c.ativo.id);
    formData.set("responsavelId", c.identidade.id);
    formData.set("setor", "Manutencao");

    expect((await criarEmissaoAction({ ok: false }, formData)).ok).toBe(false);
  });

  test("lançar serviço em item ARQUIVADO é recusado", async () => {
    const c = await cenario();
    await db.itemRevisional.update({
      where: { id: c.item.id },
      data: { status: "Arquivado" },
    });

    const formData = new FormData();
    formData.set("ativoId", c.ativo.id);
    formData.set("responsavelId", c.identidade.id);
    formData.set("setor", "Manutencao");
    formData.set("servicoCount", "1");
    formData.set("servico-0-pessoaId", c.pessoa.id);
    formData.set("servico-0-itemRevisionalId", c.item.id);
    formData.set("servico-0-modo", "Duracao");
    formData.set("servico-0-horas", "2:00");

    expect((await criarEmissaoAction({ ok: false }, formData)).ok).toBe(false);
  });

  test("editar uma emissão cujo ativo foi desativado DEPOIS continua possível", async () => {
    // O caso que a regra NÃO pode quebrar. Sem a exceção, vender um ativo
    // tornaria ineditáveis todas as emissões dele — o defeito da Story 7.5.
    const c = await cenario();
    await db.ativo.update({ where: { id: c.ativo.id }, data: { status: "Vendido" } });

    const emissao = await db.emissao.findUniqueOrThrow({ where: { id: c.emissao.id } });
    const formData = new FormData();
    formData.set("emissaoId", emissao.id);
    formData.set("updatedAt", emissao.updatedAt.toISOString());
    formData.set("ativoId", c.ativo.id);
    formData.set("responsavelId", c.identidade.id);
    formData.set("setor", "Producao");

    const estado = await editarEmissaoAction({ ok: false }, formData);

    expect(estado.ok).toBe(true);
    const relida = await db.emissao.findUniqueOrThrow({ where: { id: emissao.id } });
    expect(relida.setor).toBe("Producao");
  });

  test("editar preservando lançamento em item arquivado DEPOIS continua possível", async () => {
    const c = await cenario();
    await db.servicoEmissao.create({
      data: {
        emissaoId: c.emissao.id,
        pessoaId: c.pessoa.id,
        itemRevisionalId: c.item.id,
        modo: "Duracao",
        duracaoMinutos: 120,
      },
    });
    await db.itemRevisional.update({
      where: { id: c.item.id },
      data: { status: "Arquivado" },
    });

    const emissao = await db.emissao.findUniqueOrThrow({ where: { id: c.emissao.id } });
    const formData = new FormData();
    formData.set("emissaoId", emissao.id);
    formData.set("updatedAt", emissao.updatedAt.toISOString());
    formData.set("ativoId", c.ativo.id);
    formData.set("responsavelId", c.identidade.id);
    formData.set("setor", "Manutencao");
    formData.set("servicoCount", "1");
    formData.set("servico-0-pessoaId", c.pessoa.id);
    formData.set("servico-0-itemRevisionalId", c.item.id);
    formData.set("servico-0-modo", "Duracao");
    formData.set("servico-0-horas", "2:00");

    expect((await editarEmissaoAction({ ok: false }, formData)).ok).toBe(true);
  });
});

describe("plano: o vínculo e o responsável já gravados", () => {
  function formDePlano(c: Awaited<ReturnType<typeof cenario>>, updatedAt: Date) {
    const formData = new FormData();
    formData.set("planoId", c.plano.id);
    formData.set("updatedAt", updatedAt.toISOString());
    formData.set("nome", c.plano.nome);
    formData.set("vinculo", "ativo");
    formData.set("ativoId", c.ativo.id);
    formData.set("responsavelId", c.identidade.id);
    formData.set("itemSelecionado-" + c.item.id, "on");
    return formData;
  }

  test("editar um plano cujo RESPONSÁVEL foi desativado depois continua possível", async () => {
    // Regressão introduzida em 27-10-2026 (commit aa61c58): a regra de
    // responsável ativo foi ligada na validação do plano sem a exceção do
    // valor já gravado, então desativar um usuário tornava ineditáveis todos
    // os planos dele. Mesmo defeito da Story 7.5, numa terceira tela.
    const c = await cenario();
    await db.vinculoConta.updateMany({
      where: { contaId: c.conta.id, usuarioId: c.identidade.id },
      data: { status: "Inativo" },
    });

    const plano = await db.planoRevisional.findUniqueOrThrow({ where: { id: c.plano.id } });
    const estado = await editarPlanoAction({ ok: false }, formDePlano(c, plano.updatedAt));

    expect(estado.ok).toBe(true);
  });

  test("editar um plano cujo ATIVO foi vendido depois continua possível", async () => {
    const c = await cenario();
    await db.ativo.update({ where: { id: c.ativo.id }, data: { status: "Vendido" } });

    const plano = await db.planoRevisional.findUniqueOrThrow({ where: { id: c.plano.id } });
    const estado = await editarPlanoAction({ ok: false }, formDePlano(c, plano.updatedAt));

    expect(estado.ok).toBe(true);
  });

  test("mas TROCAR para um ativo vendido é recusado", async () => {
    const c = await cenario();
    const outro = await db.ativo.create({
      data: {
        contaId: c.conta.id,
        tipoAtivoId: c.tipoAtivo.id,
        nome: "Outro ativo",
        localizacao: "Pátio",
        codigo: "AT-OUTRO-" + Date.now(),
        status: "Vendido",
      },
    });

    const plano = await db.planoRevisional.findUniqueOrThrow({ where: { id: c.plano.id } });
    const formData = formDePlano(c, plano.updatedAt);
    formData.set("ativoId", outro.id);

    expect((await editarPlanoAction({ ok: false }, formData)).ok).toBe(false);
  });
});
