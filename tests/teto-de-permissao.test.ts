import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  ERRO_ACIMA_DO_TETO,
  permissoesAcimaDoTeto,
  type PermissaoDeModulo,
} from "@/src/lib/teto-de-permissao";

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

const { criarPerfilAcessoAction, editarPerfilAcessoAction } = await import(
  "@/src/server/actions/perfil-acesso"
);
const { permissoesDoPerfil } = await import("@/src/server/repositories/perfil-acesso");

import { criarAmbiente, db, limparBanco } from "./setup/fixtures";

beforeEach(limparBanco);

// Diferido da Story 1.3, fechado em 29-10-2026: nada limitava as permissões
// que um perfil com `editar` em `perfil` podia conceder. Quem administrava
// papéis virava administrador total em dois cliques — e a gravação era
// legítima, então nenhuma trilha mostraria escalada.
//
// A regra clássica de RBAC: ninguém concede o que não tem.

function permissao(
  modulo: string,
  criar = false,
  editar = false,
  excluir = false,
): PermissaoDeModulo {
  return { modulo, criar, editar, excluir };
}

describe("a regra do teto", () => {
  test("conceder o que o ator tem é aceito", () => {
    expect(
      permissoesAcimaDoTeto([permissao("ativos", true)], [permissao("ativos", true, true, true)]),
    ).toEqual([]);
  });

  test("conceder o que o ator NÃO tem é recusado, na caixa exata", () => {
    const erros = permissoesAcimaDoTeto(
      [permissao("ativos", false, false, true)],
      [permissao("ativos", true, true, false)],
    );
    expect(erros).toEqual([{ field: "perm-ativos-excluir", message: ERRO_ACIMA_DO_TETO }]);
  });

  test("módulo ausente no perfil do ator nega tudo daquele módulo", () => {
    // Negar por omissão, nunca liberar — mesmo critério de `can()` quando a
    // linha de permissão não existe.
    const erros = permissoesAcimaDoTeto(
      [permissao("planos", true, true, true)],
      [permissao("ativos", true, true, true)],
    );
    expect(erros.map((e) => e.field)).toEqual([
      "perm-planos-criar",
      "perm-planos-editar",
      "perm-planos-excluir",
    ]);
  });

  test("TIRAR uma permissão que o ator não tem é sempre aceito", () => {
    // Reduzir o alcance de outro perfil nunca aumenta o do ator. Bloquear
    // isso impediria um perfil restrito de corrigir um excesso que ele
    // mesmo enxerga.
    expect(
      permissoesAcimaDoTeto([permissao("ativos", false, false, false)], [permissao("ativos")]),
    ).toEqual([]);
  });

  test("MANTER o que o alvo já tinha não é conceder", () => {
    // Sem esta exceção, um perfil restrito que abrisse um perfil mais
    // poderoso e salvasse sem mexer em nada receberia erro em cada caixa
    // que não é dele — tornando o alvo ineditável. Mesmo defeito que
    // `atualId` evita em src/lib/selecionavel.ts.
    expect(
      permissoesAcimaDoTeto(
        [permissao("ativos", true, true, true)],
        [permissao("ativos", true)],
        [permissao("ativos", true, true, true)],
      ),
    ).toEqual([]);
  });

  test("mas ACRESCENTAR além do que o alvo já tinha continua recusado", () => {
    // O vizinho que distingue a exceção de um portão aberto: se bastasse o
    // alvo ter algo, o ator poderia somar o resto em cima.
    const erros = permissoesAcimaDoTeto(
      [permissao("ativos", true, true, true)],
      [permissao("ativos", true)],
      [permissao("ativos", false, true, false)],
    );
    expect(erros.map((e) => e.field)).toEqual(["perm-ativos-excluir"]);
  });

  test("nada solicitado, nenhum erro", () => {
    expect(permissoesAcimaDoTeto([], [])).toEqual([]);
  });
});

describe("a Server Action aplica o teto", () => {
  async function atorRestrito() {
    const ambiente = await criarAmbiente();
    // O ator administra PERFIS, e nada mais. É o papel que a regra existe
    // para conter.
    await db.permissaoModulo.updateMany({
      where: { perfilAcessoId: ambiente.perfil.id },
      data: { criar: false, editar: false, excluir: false },
    });
    await db.permissaoModulo.updateMany({
      where: { perfilAcessoId: ambiente.perfil.id, modulo: "perfil" },
      data: { criar: true, editar: true, excluir: false },
    });
    sessaoDeTeste.usuario = {
      id: ambiente.identidade.id,
      contaId: ambiente.conta.id,
      perfilAcessoId: ambiente.perfil.id,
    };
    return ambiente;
  }

  function formDePerfil(nome: string, permissoes: Record<string, string>) {
    const formData = new FormData();
    formData.set("nome", nome);
    for (const [chave, valor] of Object.entries(permissoes)) {
      formData.set(chave, valor);
    }
    return formData;
  }

  test("criar um perfil com permissão que o ator não tem é RECUSADO", async () => {
    const ambiente = await atorRestrito();

    const antes = await db.perfilAcesso.count({ where: { contaId: ambiente.conta.id } });
    const estado = await criarPerfilAcessoAction(
      { ok: false },
      formDePerfil("Perfil forjado", { "perm-ativos-excluir": "on" }),
    );

    expect(estado.ok).toBe(false);
    expect(await db.perfilAcesso.count({ where: { contaId: ambiente.conta.id } })).toBe(antes);
  });

  test("criar um perfil só com o que o ator tem é aceito", async () => {
    const ambiente = await atorRestrito();

    const estado = await criarPerfilAcessoAction(
      { ok: false },
      formDePerfil("Perfil de perfis", { "perm-perfil-criar": "on", "perm-perfil-editar": "on" }),
    );

    expect(estado.ok).toBe(true);
    const criado = await db.perfilAcesso.findFirstOrThrow({
      where: { contaId: ambiente.conta.id, nome: "Perfil de perfis" },
      include: { permissoes: true },
    });
    const doPerfil = criado.permissoes.find((p) => p.modulo === "perfil");
    expect(doPerfil?.criar).toBe(true);
  });

  test("auto-promoção é recusada: o ator não se dá o que não tem", async () => {
    // O cenário que motivou a regra — o ator editando o PRÓPRIO perfil.
    const ambiente = await atorRestrito();
    const perfil = await db.perfilAcesso.findUniqueOrThrow({
      where: { id: ambiente.perfil.id },
    });

    const formData = formDePerfil(perfil.nome, {
      "perm-perfil-criar": "on",
      "perm-perfil-editar": "on",
      "perm-usuarios-criar": "on",
      "perm-usuarios-editar": "on",
      "perm-usuarios-excluir": "on",
    });
    formData.set("perfilAcessoId", perfil.id);

    const estado = await editarPerfilAcessoAction({ ok: false }, formData);

    expect(estado.ok).toBe(false);
    const relido = await db.permissaoModulo.findFirstOrThrow({
      where: { perfilAcessoId: perfil.id, modulo: "usuarios" },
    });
    expect(relido.criar).toBe(false);
  });

  test("editar um perfil mais poderoso SEM mexer nas permissões dele é aceito", async () => {
    // O caso que a regra não pode quebrar.
    const ambiente = await atorRestrito();
    const alvo = await db.perfilAcesso.create({
      data: {
        contaId: ambiente.conta.id,
        nome: "Operação",
        permissoes: {
          create: [{ modulo: "ativos", criar: true, editar: true, excluir: true }],
        },
      },
    });

    const formData = formDePerfil("Operação renomeada", {
      "perm-ativos-criar": "on",
      "perm-ativos-editar": "on",
      "perm-ativos-excluir": "on",
    });
    formData.set("perfilAcessoId", alvo.id);

    const estado = await editarPerfilAcessoAction({ ok: false }, formData);

    expect(estado.ok).toBe(true);
    const relido = await db.perfilAcesso.findUniqueOrThrow({ where: { id: alvo.id } });
    expect(relido.nome).toBe("Operação renomeada");
  });

  test("um administrador completo continua concedendo tudo", async () => {
    // A regra não pode travar o caso normal: o perfil do seed tem todos os
    // módulos, então nada fica acima do teto dele.
    const ambiente = await criarAmbiente();
    sessaoDeTeste.usuario = {
      id: ambiente.identidade.id,
      contaId: ambiente.conta.id,
      perfilAcessoId: ambiente.perfil.id,
    };

    const estado = await criarPerfilAcessoAction(
      { ok: false },
      formDePerfil("Outro admin", {
        "perm-ativos-criar": "on",
        "perm-ativos-editar": "on",
        "perm-ativos-excluir": "on",
        "perm-usuarios-excluir": "on",
      }),
    );

    expect(estado.ok).toBe(true);
  });
});

describe("a gravação de permissões não tem no-op silencioso", () => {
  test("um módulo sem linha de permissão é CRIADO na edição, não ignorado", async () => {
    // Diferido da Story 1.3: `atualizarPerfilAcesso` fazia `updateMany` por
    // módulo e respondia {ok:true} mesmo sem ter escrito nada quando a linha
    // faltava. Hoje é `upsert` — este teste é o que impede a volta ao
    // `updateMany`, que nenhum outro teste pegaria.
    const ambiente = await criarAmbiente();
    sessaoDeTeste.usuario = {
      id: ambiente.identidade.id,
      contaId: ambiente.conta.id,
      perfilAcessoId: ambiente.perfil.id,
    };

    const alvo = await db.perfilAcesso.create({
      data: { contaId: ambiente.conta.id, nome: "Sem linhas" },
    });
    expect(await db.permissaoModulo.count({ where: { perfilAcessoId: alvo.id } })).toBe(0);

    const formData = new FormData();
    formData.set("perfilAcessoId", alvo.id);
    formData.set("nome", "Sem linhas");
    formData.set("perm-ativos-editar", "on");

    const estado = await editarPerfilAcessoAction({ ok: false }, formData);

    expect(estado.ok).toBe(true);
    const criada = await db.permissaoModulo.findFirstOrThrow({
      where: { perfilAcessoId: alvo.id, modulo: "ativos" },
    });
    expect(criada.editar).toBe(true);
  });
});

describe("o teto do ator é lido escopado pela conta (AD-1)", () => {
  test("um perfil de OUTRA conta não devolve permissão nenhuma", async () => {
    // Testado aqui, e não pela Server Action: `can()` usa o mesmo
    // `perfilAcessoId` e já barra o id de outra conta, então o caminho pela
    // action é inalcançável e um teste por ali passaria verde mesmo sem o
    // filtro. A regra vive na leitura, e é nela que fica presa.
    const contaA = await criarAmbiente({ nomeDaConta: "Conta A" });
    const contaB = await criarAmbiente({ nomeDaConta: "Conta B" });

    expect(await permissoesDoPerfil(contaA.conta.id, contaB.perfil.id)).toEqual([]);
    // E a contraprova: o mesmo perfil, pedido pela conta certa, vem cheio.
    expect((await permissoesDoPerfil(contaB.conta.id, contaB.perfil.id)).length).toBeGreaterThan(0);
  });
});
