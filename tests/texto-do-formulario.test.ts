import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  erroDeTamanho,
  lerTexto,
  lerTextoBruto,
  LIMITE_DESCRICAO,
  LIMITE_NOME,
  validarTamanho,
} from "@/src/lib/texto";

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

const { criarCargoAction } = await import("@/src/server/actions/cargo");
const { criarTipoAtivoAction } = await import("@/src/server/actions/tipo-ativo");

import { criarAmbiente, db, limparBanco } from "./setup/fixtures";

beforeEach(limparBanco);

// Dois diferidos abertos desde as Stories 1.3 e 2.1, fechados em
// 29-10-2026, que são o mesmo problema: o que entra pelo FormData não era
// nem conferido no tipo nem limitado no tamanho.

describe("lerTexto", () => {
  test("texto comum vem aparado", () => {
    const formData = new FormData();
    formData.set("nome", "  Bomba hidráulica  ");
    expect(lerTexto(formData, "nome")).toBe("Bomba hidráulica");
  });

  test("campo ausente vira string vazia", () => {
    expect(lerTexto(new FormData(), "nome")).toBe("");
  });

  test("um ARQUIVO no lugar do texto vira vazio, nunca '[object File]'", () => {
    // O defeito concreto: `String(formData.get(...))` sobre um File produz a
    // string literal "[object File]", que atravessa a validação de
    // obrigatório e é GRAVADA como se fosse o nome digitado.
    const formData = new FormData();
    formData.set("nome", new File(["x"], "foto.png", { type: "image/png" }));
    expect(lerTexto(formData, "nome")).toBe("");
  });

  test("lerTextoBruto preserva os espaços, mas também recusa arquivo", () => {
    const formData = new FormData();
    formData.set("senha", "  com espaço  ");
    expect(lerTextoBruto(formData, "senha")).toBe("  com espaço  ");
    formData.set("senha", new File(["x"], "x.bin"));
    expect(lerTextoBruto(formData, "senha")).toBe("");
  });
});

describe("validarTamanho", () => {
  test("dentro do limite não é erro", () => {
    expect(validarTamanho("a".repeat(LIMITE_NOME), LIMITE_NOME, "nome", "Nome")).toEqual([]);
  });

  test("um caractere acima é recusado, com o limite na mensagem", () => {
    const erros = validarTamanho("a".repeat(LIMITE_NOME + 1), LIMITE_NOME, "nome", "Nome");
    expect(erros).toEqual([{ field: "nome", message: erroDeTamanho("Nome", LIMITE_NOME) }]);
  });

  test("vazio e nulo não são erro — obrigatoriedade é outra validação", () => {
    expect(validarTamanho("", LIMITE_NOME, "nome", "Nome")).toEqual([]);
    expect(validarTamanho(null, LIMITE_NOME, "nome", "Nome")).toEqual([]);
  });

  test("conta CARACTERES, não unidades UTF-16", () => {
    // Com `.length`, cada emoji conta 2 e o limite mudaria conforme o
    // alfabeto — um nome em emoji caberia pela metade do que um em latim.
    const emojis = "🙂".repeat(LIMITE_NOME);
    expect(emojis.length).toBe(LIMITE_NOME * 2);
    expect(validarTamanho(emojis, LIMITE_NOME, "nome", "Nome")).toEqual([]);
  });
});

describe("as Server Actions aplicam o teto", () => {
  async function sessao() {
    const ambiente = await criarAmbiente();
    sessaoDeTeste.usuario = {
      id: ambiente.identidade.id,
      contaId: ambiente.conta.id,
      perfilAcessoId: ambiente.perfil.id,
    };
    return ambiente;
  }

  test("descrição de cargo acima do limite é RECUSADA e nada é gravado", async () => {
    const ambiente = await sessao();

    const formData = new FormData();
    formData.set("descricao", "a".repeat(LIMITE_DESCRICAO + 1));
    formData.set("status", "Ativo");

    const estado = await criarCargoAction({ ok: false }, formData);

    expect(estado.ok).toBe(false);
    expect(await db.cargo.count({ where: { contaId: ambiente.conta.id } })).toBe(0);
  });

  test("exatamente no limite é aceito", async () => {
    // O vizinho que impede o erro de contorno: um `<` no lugar de `<=`
    // recusaria o valor máximo legítimo.
    const ambiente = await sessao();

    const formData = new FormData();
    formData.set("descricao", "a".repeat(LIMITE_DESCRICAO));
    formData.set("status", "Ativo");

    expect((await criarCargoAction({ ok: false }, formData)).ok).toBe(true);
    expect(await db.cargo.count({ where: { contaId: ambiente.conta.id } })).toBe(1);
  });

  test("um ARQUIVO no campo nome é recusado como campo vazio", async () => {
    const ambiente = await sessao();

    const formData = new FormData();
    formData.set("nome", new File(["x"], "payload.bin"));
    formData.set("status", "Ativo");

    const estado = await criarTipoAtivoAction({ ok: false }, formData);

    expect(estado.ok).toBe(false);
    expect(await db.tipoAtivo.count({ where: { contaId: ambiente.conta.id } })).toBe(0);
  });

  test("nome de tipo acima do limite é recusado", async () => {
    const ambiente = await sessao();

    const formData = new FormData();
    formData.set("nome", "a".repeat(LIMITE_NOME + 1));
    formData.set("status", "Ativo");

    expect((await criarTipoAtivoAction({ ok: false }, formData)).ok).toBe(false);
    expect(await db.tipoAtivo.count({ where: { contaId: ambiente.conta.id } })).toBe(0);
  });

  test("descrição opcional acima do limite também é recusada", async () => {
    // Opcional não quer dizer ilimitado — e é o campo que escapa da
    // validação de obrigatório, onde um teto esquecido passaria sem ruído.
    const ambiente = await sessao();

    const formData = new FormData();
    formData.set("nome", "Caminhão");
    formData.set("descricao", "a".repeat(LIMITE_DESCRICAO + 1));
    formData.set("status", "Ativo");

    expect((await criarTipoAtivoAction({ ok: false }, formData)).ok).toBe(false);
    expect(await db.tipoAtivo.count({ where: { contaId: ambiente.conta.id } })).toBe(0);
  });
});
