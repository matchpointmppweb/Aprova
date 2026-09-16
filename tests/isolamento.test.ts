import { beforeEach, describe, expect, test } from "vitest";

import { listarUsuarios, criarUsuarioConvidado } from "@/src/server/repositories/usuario";
import { aplicarNomeDoVinculoEmLista } from "@/src/server/repositories/vinculo-conta";
import { buscarPermissaoDoModulo, listarPerfisAcesso } from "@/src/server/repositories/perfil-acesso";
import { can } from "@/src/server/auth/can";

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

// Requisito 2 da reestruturação: isolamento estrito. Nunca deve haver vazamento
// de dados entre contas — incluindo vazamento de NOMES, que é a forma sutil e a
// que de fato escapou até a revisão da Story 6.6.
describe("isolamento entre contas (NFR2/AD-1)", () => {
  test("a listagem de usuários só enxerga vínculos da própria conta", async () => {
    const alfa = await criarAmbiente({ nomeNaConta: "Pessoa da Alfa" });
    const beta = await criarAmbiente({ nomeNaConta: "Pessoa da Beta" });

    const naAlfa = await listarUsuarios(alfa.conta.id);
    const naBeta = await listarUsuarios(beta.conta.id);

    expect(naAlfa.map((u) => u.nome)).toEqual(["Pessoa da Alfa"]);
    expect(naBeta.map((u) => u.nome)).toEqual(["Pessoa da Beta"]);
  });

  // O VAZAMENTO CONCRETO que a Story 6.6 fechou, e que a revisão descobriu
  // ainda aberto nas telas de Planos e Emissão: um administrador convida um
  // e-mail qualquer, atribui a pessoa como responsável, e lê na tabela o nome
  // que OUTRA conta digitou — sondando quem existe na plataforma.
  test("o nome exibido é o do vínculo desta conta, nunca o da identidade", async () => {
    const identidade = await criarIdentidade({
      nome: "Nome secreto da conta Alfa",
      email: "pessoa@teste.local",
    });

    const alfa = await criarConta({ nome: "Alfa" });
    await criarVinculo(identidade.id, alfa.id, (await criarPerfil(alfa.id)).id, {
      nome: "Nome secreto da conta Alfa",
    });

    const beta = await criarConta({ nome: "Beta" });
    await criarVinculo(identidade.id, beta.id, (await criarPerfil(beta.id)).id, {
      nome: "Apelido na Beta",
    });

    // Como a tabela de Planos/Emissão recebe os dados: o `nome` vem da relação
    // com a identidade, e é justamente o valor que não pode ser exibido.
    const registros = [
      { id: "plano-1", responsavel: { id: identidade.id, nome: identidade.nome } },
    ];

    const corrigidos = await aplicarNomeDoVinculoEmLista(beta.id, registros);

    expect(corrigidos[0].responsavel.nome).toBe("Apelido na Beta");
    expect(corrigidos[0].responsavel.nome).not.toBe("Nome secreto da conta Alfa");
  });

  test("responsável sem vínculo nesta conta mantém o rótulo que veio", async () => {
    // Caso legítimo: alguém removido da conta continua nomeado na linha
    // histórica. Não é vazamento — a conta já conhecia essa pessoa.
    const identidade = await criarIdentidade({ nome: "Ex-integrante" });
    const conta = await criarConta();

    const corrigidos = await aplicarNomeDoVinculoEmLista(conta.id, [
      { id: "x", responsavel: { id: identidade.id, nome: "Ex-integrante" } },
    ]);

    expect(corrigidos[0].responsavel.nome).toBe("Ex-integrante");
  });

  test("perfis de acesso não atravessam contas", async () => {
    const alfa = await criarAmbiente();
    const beta = await criarAmbiente();

    const perfisDaAlfa = await listarPerfisAcesso(alfa.conta.id);

    expect(perfisDaAlfa.map((p) => p.id)).toContain(alfa.perfil.id);
    expect(perfisDaAlfa.map((p) => p.id)).not.toContain(beta.perfil.id);
  });

  // A defesa central do AD-2: `can()` sempre escopa a busca da permissão pela
  // contaId do usuário. Um perfilAcessoId de outra conta jamais é encontrado —
  // mesmo que o valor seja verdadeiro e o perfil libere tudo.
  test("perfil de outra conta nunca autoriza nada", async () => {
    const alfa = await criarAmbiente();
    const beta = await criarAmbiente();

    // Perfil real, existente, com acesso total — mas da conta Beta.
    const autorizado = await can(
      { contaId: beta.conta.id, perfilAcessoId: beta.perfil.id },
      "criar",
      "ativos",
    );
    expect(autorizado).toBe(true);

    // O MESMO perfil, cruzado com a conta Alfa: nega.
    const cruzado = await can(
      { contaId: alfa.conta.id, perfilAcessoId: beta.perfil.id },
      "criar",
      "ativos",
    );
    expect(cruzado).toBe(false);
  });

  test("permissão inexistente nega, em vez de assumir liberado", async () => {
    const { conta } = await criarAmbiente();
    const semPermissoes = await db.perfilAcesso.create({
      data: { contaId: conta.id, nome: "Perfil vazio" },
    });

    expect(
      await can(
        { contaId: conta.id, perfilAcessoId: semPermissoes.id },
        "criar",
        "ativos",
      ),
    ).toBe(false);
    expect(
      await buscarPermissaoDoModulo(semPermissoes.id, conta.id, "ativos"),
    ).toBeNull();
  });
});

// Requisito 3: identidade global por e-mail, com vínculos e perfis diferentes
// por conta.
describe("identidade global (FR20/FR21)", () => {
  test("o mesmo e-mail atende duas contas com perfis diferentes", async () => {
    const identidade = await criarIdentidade({ email: "multi@teste.local" });

    const alfa = await criarConta({ nome: "Alfa" });
    const admin = await criarPerfil(alfa.id, { nome: "Administrador" });
    await criarVinculo(identidade.id, alfa.id, admin.id);

    const beta = await criarConta({ nome: "Beta" });
    const tecnico = await criarPerfil(beta.id, {
      nome: "Técnico",
      permitirTudo: false,
    });
    await criarVinculo(identidade.id, beta.id, tecnico.id);

    // Administrador na Alfa, Técnico sem permissão na Beta — a MESMA pessoa.
    expect(
      await can({ contaId: alfa.id, perfilAcessoId: admin.id }, "excluir", "ativos"),
    ).toBe(true);
    expect(
      await can({ contaId: beta.id, perfilAcessoId: tecnico.id }, "excluir", "ativos"),
    ).toBe(false);
  });

  test("o e-mail é único na plataforma inteira", async () => {
    await criarIdentidade({ email: "unico@teste.local" });
    await expect(criarIdentidade({ email: "unico@teste.local" })).rejects.toThrow();
  });

  // Ramo do convite da Story 6.6: e-mail já existente não vira identidade nova
  // nem é renomeado — ganha o vínculo desta conta.
  test("convidar e-mail já existente cria só o vínculo", async () => {
    const existente = await criarIdentidade({
      nome: "Nome original",
      email: "convidado@teste.local",
    });
    const conta = await criarConta();
    const perfil = await criarPerfil(conta.id);

    const resultado = await criarUsuarioConvidado(conta.id, {
      nome: "Nome nesta conta",
      email: "convidado@teste.local",
      perfilAcessoId: perfil.id,
    });

    expect(resultado.resultado).not.toBe("ja-tem-acesso");
    expect(await db.usuario.count({ where: { email: "convidado@teste.local" } })).toBe(1);

    const recarregada = await db.usuario.findUniqueOrThrow({
      where: { id: existente.id },
    });
    expect(recarregada.nome).toBe("Nome original");
  });

  test("convidar quem já tem vínculo ativo é recusado", async () => {
    const { conta, perfil, identidade, vinculo } = await criarAmbiente();

    const resultado = await criarUsuarioConvidado(conta.id, {
      nome: "Tentativa",
      email: identidade.email,
      perfilAcessoId: perfil.id,
    });

    expect(resultado.resultado).toBe("ja-tem-acesso");
    // E nada foi alterado no vínculo existente.
    const inalterado = await db.vinculoConta.findUniqueOrThrow({
      where: { id: vinculo.id },
    });
    expect(inalterado.nome).toBe(vinculo.nome);
  });

  test("vínculo inativo é reativado, nunca duplicado", async () => {
    const { conta, perfil, identidade, vinculo } = await criarAmbiente();
    await db.vinculoConta.update({
      where: { id: vinculo.id },
      data: { status: "Inativo" },
    });

    await criarUsuarioConvidado(conta.id, {
      nome: "Nome do reconvite",
      email: identidade.email,
      perfilAcessoId: perfil.id,
    });

    const vinculos = await db.vinculoConta.findMany({
      where: { contaId: conta.id, usuarioId: identidade.id },
    });
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0].status).not.toBe("Inativo");
    expect(vinculos[0].nome).toBe("Nome do reconvite");
  });
});
