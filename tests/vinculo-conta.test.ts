import { beforeEach, describe, expect, test } from "vitest";

import {
  resolverUsuarioAutenticadoPeloVinculo,
  resolveuAConta,
  listarOpcoesDeAmbiente,
  STATUS_COM_ACESSO,
  STATUS_COM_LOGIN,
} from "@/src/server/repositories/vinculo-conta";

import {
  criarAmbiente,
  criarConta,
  criarIdentidade,
  criarPerfil,
  criarVinculo,
  db,
  limparBanco,
} from "./setup/fixtures";

beforeEach(limparBanco);

// Este arquivo cobre as QUATRO regressões silenciosas identificadas nas
// revisões do Epic 6 — cada uma passa por ESLint, `tsc` e `next build` sem
// nada falhar, e três delas têm consequência de segurança direta. Cada `test`
// abaixo nomeia a regressão que existe para pegar.

describe("resolução do vínculo (NFR6)", () => {
  test("um único ambiente é derivado sem escolha", async () => {
    const { identidade, conta, vinculo } = await criarAmbiente({
      nomeNaConta: "Ana na Alfa",
    });

    const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
      identidade.id,
      STATUS_COM_ACESSO,
    );

    expect(resolucao.tipo).toBe("resolvido");
    if (resolucao.tipo !== "resolvido") return;
    expect(resolucao.usuario.contaId).toBe(conta.id);
    expect(resolucao.usuario.perfilAcessoId).toBe(vinculo.perfilAcessoId);
    // O nome vem do VÍNCULO, não da identidade (Story 6.6).
    expect(resolucao.usuario.nome).toBe("Ana na Alfa");
  });

  // REGRESSÃO 1: trocar os ramos da união de resolução. Com dois ambientes o
  // resultado tem de ser "ambiguo" (vai escolher), nunca "resolvido" — resolver
  // aqui é entrar num ambiente que a pessoa não escolheu, contornando o FR22.
  test("dois ambientes exigem escolha, nunca entram direto", async () => {
    const identidade = await criarIdentidade();
    const alfa = await criarConta({ nome: "Alfa" });
    const beta = await criarConta({ nome: "Beta" });
    await criarVinculo(identidade.id, alfa.id, (await criarPerfil(alfa.id)).id);
    await criarVinculo(identidade.id, beta.id, (await criarPerfil(beta.id)).id);

    const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
      identidade.id,
      STATUS_COM_ACESSO,
    );

    expect(resolucao.tipo).toBe("ambiguo");
  });

  test("nenhum ambiente é 'sem-ambiente', não 'ambiguo'", async () => {
    const identidade = await criarIdentidade();

    const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
      identidade.id,
      STATUS_COM_ACESSO,
    );

    expect(resolucao.tipo).toBe("sem-ambiente");
  });

  // REGRESSÃO 2: afrouxar o `where` de `buscarVinculoUtilizavel`. Sem as três
  // condições juntas, acesso revogado continua valendo até o token de sessão
  // expirar — até sete dias de acesso indevido.
  describe("acesso revogado nega já na requisição seguinte", () => {
    test("vínculo desativado", async () => {
      const { identidade, conta, vinculo } = await criarAmbiente();
      await db.vinculoConta.update({
        where: { id: vinculo.id },
        data: { status: "Inativo" },
      });

      const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
        identidade.id,
        STATUS_COM_ACESSO,
        conta.id,
      );

      expect(resolucao.tipo).not.toBe("resolvido");
    });

    test("vínculo apagado", async () => {
      const { identidade, conta, vinculo } = await criarAmbiente();
      await db.vinculoConta.delete({ where: { id: vinculo.id } });

      const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
        identidade.id,
        STATUS_COM_ACESSO,
        conta.id,
      );

      expect(resolucao.tipo).toBe("sem-ambiente");
    });

    test("identidade banida globalmente", async () => {
      const { identidade, conta } = await criarAmbiente();
      await db.usuario.update({
        where: { id: identidade.id },
        data: { status: "Inativo" },
      });

      const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
        identidade.id,
        STATUS_COM_ACESSO,
        conta.id,
      );

      expect(resolucao.tipo).not.toBe("resolvido");
    });

    test("conta com pagamento pendente", async () => {
      const { identidade, conta } = await criarAmbiente();
      await db.conta.update({
        where: { id: conta.id },
        data: { status: "PagamentoPendente" },
      });

      const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
        identidade.id,
        STATUS_COM_ACESSO,
        conta.id,
      );

      expect(resolucao.tipo).not.toBe("resolvido");
    });
  });

  // REGRESSÃO 3: simplificar a guarda de escolha forjada. Sem `resolveuAConta`,
  // pedir uma conta sem vínculo cai na DERIVAÇÃO e devolve OUTRA conta — que o
  // chamador então gravaria na sessão como se tivesse sido escolhida.
  test("conta forjada não resolve para outra conta", async () => {
    const { identidade, conta } = await criarAmbiente();
    const alheia = await criarConta({ nome: "Conta de terceiro" });

    const resolucao = await resolverUsuarioAutenticadoPeloVinculo(
      identidade.id,
      STATUS_COM_ACESSO,
      alheia.id,
    );

    // A derivação de fato devolve a conta legítima — este é o comportamento
    // esperado, e é exatamente por isso que `resolveuAConta` existe: aceitar a
    // resolução sem ela seria entrar num ambiente não escolhido.
    expect(resolveuAConta(resolucao, alheia.id)).toBe(false);
    expect(resolveuAConta(resolucao, conta.id)).toBe(true);
  });

  // A divergência que criava o bypass do FR22: contar por STATUS_COM_ACESSO
  // enquanto o login oferece STATUS_COM_LOGIN. Com um vínculo Ativo e outro
  // ConvitePendente, contar pela lista estreita dava "um só" e a derivação
  // entrava sem perguntar.
  test("vínculo ConvitePendente conta como ambiente escolhível", async () => {
    const identidade = await criarIdentidade();
    const alfa = await criarConta({ nome: "Alfa" });
    const beta = await criarConta({ nome: "Beta" });
    await criarVinculo(identidade.id, alfa.id, (await criarPerfil(alfa.id)).id, {
      status: "Ativo",
    });
    await criarVinculo(identidade.id, beta.id, (await criarPerfil(beta.id)).id, {
      status: "ConvitePendente",
    });

    // A guarda do painel (exige Ativo dos dois lados) não pode entrar direto.
    const pelaGuarda = await resolverUsuarioAutenticadoPeloVinculo(
      identidade.id,
      STATUS_COM_ACESSO,
    );
    expect(pelaGuarda.tipo).toBe("ambiguo");

    // E a tela de seleção oferece os DOIS — as duas perguntas têm de dar a
    // mesma resposta.
    const opcoes = await listarOpcoesDeAmbiente(identidade.id);
    expect(opcoes).toHaveLength(2);
  });

  test("login aceita ConvitePendente; a guarda do painel não", async () => {
    const conta = await criarConta();
    const perfil = await criarPerfil(conta.id);
    const identidade = await criarIdentidade();
    await criarVinculo(identidade.id, conta.id, perfil.id, {
      status: "ConvitePendente",
    });

    const noLogin = await resolverUsuarioAutenticadoPeloVinculo(
      identidade.id,
      STATUS_COM_LOGIN,
    );
    expect(noLogin.tipo).toBe("resolvido");

    const noPainel = await resolverUsuarioAutenticadoPeloVinculo(
      identidade.id,
      STATUS_COM_ACESSO,
    );
    expect(noPainel.tipo).toBe("sem-ambiente");
  });
});

describe("opções de ambiente (FR22/UX-DR12)", () => {
  test("só lista ambientes utilizáveis, com nome da conta e perfil", async () => {
    const identidade = await criarIdentidade();

    const alfa = await criarConta({ nome: "Alfa" });
    const perfilAlfa = await criarPerfil(alfa.id, { nome: "Administrador" });
    await criarVinculo(identidade.id, alfa.id, perfilAlfa.id);

    const beta = await criarConta({ nome: "Beta" });
    const perfilBeta = await criarPerfil(beta.id, { nome: "Técnico" });
    await criarVinculo(identidade.id, beta.id, perfilBeta.id);

    // Suspensa: não deve aparecer.
    const gama = await criarConta({ nome: "Gama", status: "PagamentoPendente" });
    await criarVinculo(identidade.id, gama.id, (await criarPerfil(gama.id)).id);

    const opcoes = await listarOpcoesDeAmbiente(identidade.id);

    expect(opcoes.map((o) => o.contaNome)).toEqual(["Alfa", "Beta"]);
    expect(opcoes.map((o) => o.perfilNome)).toEqual(["Administrador", "Técnico"]);
  });

  test("não enxerga ambiente de outra identidade", async () => {
    const primeira = await criarAmbiente();
    const segunda = await criarAmbiente();

    const opcoes = await listarOpcoesDeAmbiente(primeira.identidade.id);

    expect(opcoes).toHaveLength(1);
    expect(opcoes[0].contaId).toBe(primeira.conta.id);
    expect(opcoes[0].contaId).not.toBe(segunda.conta.id);
  });
});
