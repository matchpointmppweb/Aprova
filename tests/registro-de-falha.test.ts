import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { registrarFalha } from "@/src/server/log";

// Diferido da Story 4.1, fechado em 29-10-2026: as Server Actions engoliam
// qualquer erro inesperado num `catch` genérico. Do lado de fora, uma
// violação de regra de negócio e um banco fora do ar davam a MESMA resposta,
// e não ficava nada em lugar nenhum dizendo qual dos dois tinha acontecido.
//
// O formato do log é o contrato: é por ele que se procura. Um prefixo
// trocado ou um JSON que vira "[object Object]" torna o rastro inútil sem
// quebrar nada visível — daí estes testes.

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

// O repositório é substituído por um que QUEBRA — é a única forma de
// provocar a falha inesperada que o `catch` genérico existe para tratar.
vi.mock("@/src/server/repositories/cargo", async (importarReal) => {
  const real = await importarReal<typeof import("@/src/server/repositories/cargo")>();
  return {
    ...real,
    criarCargo: async () => {
      throw new Error("banco fora do ar");
    },
  };
});

const { criarCargoAction } = await import("@/src/server/actions/cargo");

import { criarAmbiente, limparBanco } from "./setup/fixtures";

let capturado: unknown[][] = [];

beforeEach(() => {
  capturado = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    capturado.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function ultimoRegistro() {
  const [prefixo, corpo] = capturado[capturado.length - 1] as [string, string];
  return { prefixo, dados: JSON.parse(corpo) as Record<string, unknown> };
}

describe("registrarFalha", () => {
  test("registra operação, conta e o erro, sob um prefixo procurável", () => {
    registrarFalha(
      { operacao: "criarCargoAction", contaId: "conta-1" },
      new Error("conexão recusada"),
    );

    const { prefixo, dados } = ultimoRegistro();
    expect(prefixo).toBe("[raiz:falha]");
    expect(dados.operacao).toBe("criarCargoAction");
    expect(dados.contaId).toBe("conta-1");
    expect(dados.mensagem).toBe("conexão recusada");
    expect(dados.tipo).toBe("Error");
  });

  test("a pilha vai junto — é o que localiza o defeito", () => {
    registrarFalha({ operacao: "x" }, new Error("falhou"));
    expect(String(ultimoRegistro().dados.pilha)).toContain("Error: falhou");
  });

  test("sem conta, o campo vem nulo em vez de sumir", () => {
    // Chave sempre presente: um log em que o campo às vezes falta obriga
    // quem procura a adivinhar se é ausência de conta ou de registro.
    registrarFalha({ operacao: "entrarAction" }, new Error("x"));
    const { dados } = ultimoRegistro();
    expect("contaId" in dados).toBe(true);
    expect(dados.contaId).toBeNull();
  });

  test("um erro que NÃO é Error também é registrado", () => {
    // `throw "texto"` e `throw {codigo:1}` acontecem em biblioteca de
    // terceiro. Se o registro dependesse de `erro.message`, esses casos
    // virariam "undefined" — justamente os mais difíceis de diagnosticar.
    registrarFalha({ operacao: "x" }, { codigo: 500 });
    const { dados } = ultimoRegistro();
    expect(dados.tipo).toBe("object");
    expect(dados.mensagem).toBe("[object Object]");
  });

  test("o corpo é JSON de uma linha, não um objeto solto", () => {
    // `console.error("...", objeto)` imprime "[object Object]" em boa parte
    // dos coletores de log — o rastro existiria e seria ilegível.
    registrarFalha({ operacao: "x" }, new Error("y"));
    const [, corpo] = capturado[capturado.length - 1] as [string, unknown];
    expect(typeof corpo).toBe("string");
    expect(String(corpo).includes("\n")).toBe(false);
  });

  test("não registra valor de campo nenhum", () => {
    // Log de produção não é lugar para o que a pessoa digitou. O contexto
    // aceita só operação e conta, e o teste existe para que acrescentar um
    // campo de dados seja uma decisão consciente, não um descuido.
    registrarFalha({ operacao: "criarPessoaAction", contaId: "c" }, new Error("x"));
    const { dados } = ultimoRegistro();
    expect(Object.keys(dados).sort()).toEqual(
      ["contaId", "mensagem", "operacao", "pilha", "quando", "tipo"].sort(),
    );
  });
});

describe("a Server Action deixa rastro da falha inesperada", () => {
  beforeEach(limparBanco);

  test("o usuário recebe a mensagem genérica E o erro vai para o log", async () => {
    // As duas metades importam. Sem a primeira, vazaria detalhe de banco
    // para a tela; sem a segunda, um defeito de produção continuaria
    // invisível até alguém reclamar.
    const ambiente = await criarAmbiente();
    sessaoDeTeste.usuario = {
      id: ambiente.identidade.id,
      contaId: ambiente.conta.id,
      perfilAcessoId: ambiente.perfil.id,
    };

    const formData = new FormData();
    formData.set("descricao", "Mecânico");
    formData.set("status", "Ativo");

    const estado = await criarCargoAction({ ok: false }, formData);

    expect(estado.ok).toBe(false);
    expect(typeof estado.error).toBe("string");
    // A mensagem ao usuário não conta o que houve.
    expect(String(estado.error)).not.toContain("banco fora do ar");

    const { prefixo, dados } = ultimoRegistro();
    expect(prefixo).toBe("[raiz:falha]");
    expect(dados.operacao).toBe("criarCargoAction");
    expect(dados.contaId).toBe(ambiente.conta.id);
    expect(dados.mensagem).toBe("banco fora do ar");
  });
});
