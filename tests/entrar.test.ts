import { beforeEach, describe, expect, test, vi } from "vitest";
import { hashPassword } from "better-auth/crypto";

// `next/headers` e `next/navigation` só existem dentro de uma requisição do
// Next. Os dublês abaixo são o MÍNIMO para que a Server Action rode fora dele:
// cabeçalhos e cookies de mentira, e um `redirect` que lança como o de verdade
// (é assim que o Next interrompe a ação). Tudo o mais — Better Auth, Prisma,
// banco — é real.
const cabecalhos = new Headers();
const cookies = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => cabecalhos,
  cookies: async () => ({
    get: (nome: string) =>
      cookies.has(nome) ? { name: nome, value: cookies.get(nome) } : undefined,
    getAll: () =>
      [...cookies].map(([name, value]) => ({ name, value })),
    set: (nome: string, valor: string) => cookies.set(nome, valor),
    delete: (nome: string) => cookies.delete(nome),
  }),
}));

class RedirecionamentoDeTeste extends Error {
  constructor(readonly destino: string) {
    super(`redirect:${destino}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new RedirecionamentoDeTeste(destino);
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { entrarAction } = await import("@/src/server/actions/auth");

import {
  criarAmbiente,
  criarConta,
  criarIdentidade,
  criarPerfil,
  criarVinculo,
  db,
  limparBanco,
} from "./setup/fixtures";

const SENHA = "senha-de-teste-1234";

beforeEach(async () => {
  await limparBanco();
  cookies.clear();
});

async function comCredencial(usuarioId: string) {
  await db.account.create({
    data: {
      userId: usuarioId,
      providerId: "credential",
      accountId: usuarioId,
      password: await hashPassword(SENHA),
    },
  });
}

function formulario(email: string, senha: string) {
  const dados = new FormData();
  dados.set("email", email);
  dados.set("senha", senha);
  return dados;
}

/// Executa a action devolvendo o estado OU o destino do redirect, que no Next
/// é uma exceção e não um valor de retorno.
async function entrar(email: string, senha: string) {
  try {
    const estado = await entrarAction({ ok: false }, formulario(email, senha));
    return { tipo: "estado" as const, estado };
  } catch (erro) {
    if (erro instanceof RedirecionamentoDeTeste) {
      return { tipo: "redirect" as const, destino: erro.destino };
    }
    throw erro;
  }
}

// O fluxo de login completo, exercitado de ponta a ponta contra Better Auth e
// banco reais — a lacuna que o deferred-work.md registra desde a Story 1.1.
describe("entrarAction", () => {
  test("senha correta com um ambiente só entra direto", async () => {
    const { identidade } = await criarAmbiente();
    await comCredencial(identidade.id);

    const resultado = await entrar(identidade.email, SENHA);

    expect(resultado).toEqual({ tipo: "redirect", destino: "/" });
  });

  test("senha errada é recusada", async () => {
    const { identidade } = await criarAmbiente();
    await comCredencial(identidade.id);

    const resultado = await entrar(identidade.email, "senha-errada");

    expect(resultado.tipo).toBe("estado");
    if (resultado.tipo !== "estado") return;
    expect(resultado.estado.ok).toBe(false);
    expect(resultado.estado.error).toBe("E-mail ou senha inválidos.");
  });

  // FR22: com mais de um ambiente, a sessão fica de pé mas ninguém entra em
  // conta nenhuma sem escolher.
  test("com dois ambientes vai para a tela de escolha", async () => {
    const identidade = await criarIdentidade();
    await comCredencial(identidade.id);
    const alfa = await criarConta();
    const beta = await criarConta();
    await criarVinculo(identidade.id, alfa.id, (await criarPerfil(alfa.id)).id);
    await criarVinculo(identidade.id, beta.id, (await criarPerfil(beta.id)).id);

    const resultado = await entrar(identidade.email, SENHA);

    expect(resultado).toEqual({ tipo: "redirect", destino: "/escolher-ambiente" });
  });

  // AD-13: o operador de plataforma sem vínculo NÃO pode ser expulso — a área
  // dele não pertence a conta nenhuma.
  test("operador de plataforma sem vínculo vai para a área de plataforma", async () => {
    const identidade = await criarIdentidade({ isPlataformaOperador: true });
    await comCredencial(identidade.id);

    const resultado = await entrar(identidade.email, SENHA);

    expect(resultado).toEqual({ tipo: "redirect", destino: "/contas" });
  });

  test("sem ambiente e sem ser operador, é recusado", async () => {
    const identidade = await criarIdentidade();
    await comCredencial(identidade.id);

    const resultado = await entrar(identidade.email, SENHA);

    expect(resultado.tipo).toBe("estado");
    if (resultado.tipo !== "estado") return;
    expect(resultado.estado.ok).toBe(false);
  });

  test("identidade banida não entra, mesmo com a senha certa", async () => {
    const { identidade } = await criarAmbiente();
    await comCredencial(identidade.id);
    await db.usuario.update({
      where: { id: identidade.id },
      data: { status: "Inativo" },
    });

    const resultado = await entrar(identidade.email, SENHA);

    expect(resultado.tipo).toBe("estado");
    if (resultado.tipo !== "estado") return;
    expect(resultado.estado.ok).toBe(false);
  });

  test("conta com pagamento pendente não deixa entrar", async () => {
    const { identidade, conta } = await criarAmbiente();
    await comCredencial(identidade.id);
    await db.conta.update({
      where: { id: conta.id },
      data: { status: "PagamentoPendente" },
    });

    const resultado = await entrar(identidade.email, SENHA);

    expect(resultado.tipo).toBe("estado");
    if (resultado.tipo !== "estado") return;
    expect(resultado.estado.ok).toBe(false);
  });
});

// A ligação entre a action e o limitador — o que os testes do limitador
// sozinhos não cobrem.
describe("contenção de força bruta no login", () => {
  test("bloqueia depois de tentativas demais, e a mensagem muda", async () => {
    const { identidade } = await criarAmbiente();
    await comCredencial(identidade.id);

    for (let i = 0; i < 10; i++) {
      const tentativa = await entrar(identidade.email, "errada");
      expect(tentativa.tipo).toBe("estado");
      if (tentativa.tipo !== "estado") return;
      expect(tentativa.estado.error).toBe("E-mail ou senha inválidos.");
    }

    const bloqueada = await entrar(identidade.email, "errada");
    expect(bloqueada.tipo).toBe("estado");
    if (bloqueada.tipo !== "estado") return;
    expect(bloqueada.estado.error).toContain("Tentativas demais");
  });

  // O ponto que dá valor ao bloqueio: depois de estourado, nem a senha CERTA
  // passa. Sem isto, um atacante que acertasse na 11ª tentativa entraria.
  test("depois de bloqueado, nem a senha correta entra", async () => {
    const { identidade } = await criarAmbiente();
    await comCredencial(identidade.id);

    for (let i = 0; i < 10; i++) {
      await entrar(identidade.email, "errada");
    }

    const resultado = await entrar(identidade.email, SENHA);
    expect(resultado.tipo).toBe("estado");
    if (resultado.tipo !== "estado") return;
    expect(resultado.estado.error).toContain("Tentativas demais");
  });

  // Quem erra algumas vezes e acerta não pode acumular bloqueio ao longo do
  // tempo — é o caso comum de quem tem várias senhas.
  test("acertar a senha zera as falhas anteriores", async () => {
    const { identidade } = await criarAmbiente();
    await comCredencial(identidade.id);

    for (let i = 0; i < 9; i++) {
      await entrar(identidade.email, "errada");
    }

    expect(await entrar(identidade.email, SENHA)).toEqual({
      tipo: "redirect",
      destino: "/",
    });

    // Zerado: nove novas falhas ainda não bloqueiam.
    for (let i = 0; i < 9; i++) {
      const tentativa = await entrar(identidade.email, "errada");
      expect(tentativa.tipo).toBe("estado");
      if (tentativa.tipo !== "estado") return;
      expect(tentativa.estado.error).toBe("E-mail ou senha inválidos.");
    }
  });

  test("o bloqueio de um e-mail não atinge outra pessoa", async () => {
    const primeira = await criarAmbiente();
    await comCredencial(primeira.identidade.id);
    const segunda = await criarAmbiente();
    await comCredencial(segunda.identidade.id);

    for (let i = 0; i < 10; i++) {
      await entrar(primeira.identidade.email, "errada");
    }

    expect(await entrar(segunda.identidade.email, SENHA)).toEqual({
      tipo: "redirect",
      destino: "/",
    });
  });
});
