import { beforeEach, describe, expect, test, vi } from "vitest";

// Mesmo dublê de sessão dos demais testes de action: só a SESSÃO é falsa.
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

const { criarItemRevisionalAction, editarItemRevisionalAction } = await import(
  "@/src/server/actions/item-revisional"
);

import { criarAmbiente, criarItemRevisional, db, limparBanco } from "./setup/fixtures";

beforeEach(limparBanco);

// Organização do item revisional (26-10-2026) — categoria, grupo e as três
// etapas. São o que dá forma à OS impressa: categoria vira seção, grupo vira
// coluna, etapas viram as colunas do meio.
//
// O que estes testes prendem é o CONTRATO DE NOMES do FormData e a
// opcionalidade. É o mesmo buraco da Story 7.3: renomear um lado quebra a
// funcionalidade inteira com lint, typecheck e suíte verdes, porque FormData
// não é tipado.

async function comSessao() {
  const ambiente = await criarAmbiente();
  sessaoDeTeste.usuario = {
    id: ambiente.identidade.id,
    contaId: ambiente.conta.id,
    perfilAcessoId: ambiente.perfil.id,
  };
  return ambiente;
}

function formDeItem(campos: Record<string, string>) {
  const formData = new FormData();
  formData.set("nome", `Item ${Math.random()}`);
  formData.set("status", "Ativo");
  formData.set("horasPadrao", "100");
  for (const [nome, valor] of Object.entries(campos)) formData.set(nome, valor);
  return formData;
}

const CAMPOS = ["categoria", "grupo", "etapa1", "etapa2", "etapa3"] as const;

describe("criação", () => {
  test("os cinco campos gravam, cada um no seu lugar", async () => {
    const ambiente = await comSessao();

    // Valores DISTINTOS por campo, de propósito: com o mesmo valor em todos,
    // uma troca de ordem na gravação (categoria indo para grupo) passaria
    // despercebida.
    const estado = await criarItemRevisionalAction(
      { ok: false },
      formDeItem({
        nome: "Ar condicionado",
        categoria: "Elétrica",
        grupo: "Cabine",
        etapa1: "Correto funcionamento",
        etapa2: "Integridade dos componentes",
        etapa3: "Lubrificar",
      }),
    );

    expect(estado.ok).toBe(true);
    const gravado = await db.itemRevisional.findFirstOrThrow({
      where: { contaId: ambiente.conta.id },
    });
    expect(gravado.categoria).toBe("Elétrica");
    expect(gravado.grupo).toBe("Cabine");
    expect(gravado.etapa1).toBe("Correto funcionamento");
    expect(gravado.etapa2).toBe("Integridade dos componentes");
    expect(gravado.etapa3).toBe("Lubrificar");
  });

  test("todos são opcionais — em branco viram null, não string vazia", async () => {
    const ambiente = await comSessao();

    // Campo ausente E campo presente vazio: o formulário produz os dois
    // (ausente na criação, vazio quando a pessoa apaga o que havia).
    const estado = await criarItemRevisionalAction(
      { ok: false },
      formDeItem({ categoria: "", grupo: "   " }),
    );

    expect(estado.ok).toBe(true);
    const gravado = await db.itemRevisional.findFirstOrThrow({
      where: { contaId: ambiente.conta.id },
    });
    for (const campo of CAMPOS) {
      expect(gravado[campo]).toBeNull();
    }
  });

  test("espaços em volta são aparados, mas a caixa é preservada", async () => {
    const ambiente = await comSessao();

    const estado = await criarItemRevisionalAction(
      { ok: false },
      // Caixa MISTA de propósito: com "ELÉTRICA" o teste passaria mesmo se a
      // leitura normalizasse para maiúsculas, e o nome dele estaria mentindo.
      // Verificado por mutação.
      formDeItem({ categoria: "  Elétrica Pesada  " }),
    );

    expect(estado.ok).toBe(true);
    const gravado = await db.itemRevisional.findFirstOrThrow({
      where: { contaId: ambiente.conta.id },
    });
    // Aparar é higiene; normalizar a caixa seria decidir pela pessoa qual
    // grafia é a "certa" e mudar o que ela vê impresso.
    expect(gravado.categoria).toBe("Elétrica Pesada");
  });
});

describe("edição", () => {
  test("altera os cinco campos de um item existente", async () => {
    const ambiente = await comSessao();
    const item = await criarItemRevisional(ambiente.conta.id, { nome: "Filtro de ar" });

    const formData = formDeItem({
      nome: "Filtro de ar",
      categoria: "Mecânica",
      grupo: "Motor",
      etapa1: "Inspecionar",
      etapa2: "Substituir",
      etapa3: "Anexar laudo",
    });
    formData.set("itemRevisionalId", item.id);

    const estado = await editarItemRevisionalAction({ ok: false }, formData);

    expect(estado.ok).toBe(true);
    const relido = await db.itemRevisional.findUniqueOrThrow({ where: { id: item.id } });
    expect(relido.categoria).toBe("Mecânica");
    expect(relido.grupo).toBe("Motor");
    expect(relido.etapa1).toBe("Inspecionar");
    expect(relido.etapa2).toBe("Substituir");
    expect(relido.etapa3).toBe("Anexar laudo");
  });

  test("apagar o conteúdo de um campo o devolve a null", async () => {
    const ambiente = await comSessao();
    const item = await criarItemRevisional(ambiente.conta.id);
    await db.itemRevisional.update({
      where: { id: item.id },
      data: { categoria: "Elétrica", etapa1: "Inspecionar" },
    });

    const formData = formDeItem({ nome: item.nome, categoria: "", etapa1: "" });
    formData.set("itemRevisionalId", item.id);

    const estado = await editarItemRevisionalAction({ ok: false }, formData);

    expect(estado.ok).toBe(true);
    const relido = await db.itemRevisional.findUniqueOrThrow({ where: { id: item.id } });
    expect(relido.categoria).toBeNull();
    expect(relido.etapa1).toBeNull();
  });
});
