import { beforeEach, describe, expect, test } from "vitest";

import {
  atualizarUsuario,
  ativarUsuarioConvidado,
  contarAdministradoresAtivos,
  buscarIdentidadeAtiva,
} from "@/src/server/repositories/usuario";

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

// As guardas de autorização que o deferred-work.md registra sem cobertura
// desde a Story 1.2. São o tipo de código que só roda em caminho de exceção —
// ninguém as exercita no uso normal, e por isso quebram sem ninguém notar.

describe("guarda do último Administrador (Story 1.2)", () => {
  test("conta apenas quem pode administrar ESTA conta agora", async () => {
    const { conta, perfil } = await criarAmbiente();
    expect(perfil.nome).toBe("Administrador");
    expect(await contarAdministradoresAtivos(conta.id)).toBe(1);

    // Um segundo administrador, ativo: passam a ser dois.
    const segunda = await criarIdentidade();
    const vinculo = await criarVinculo(segunda.id, conta.id, perfil.id);
    expect(await contarAdministradoresAtivos(conta.id)).toBe(2);

    // Vínculo desativado deixa de contar.
    await db.vinculoConta.update({
      where: { id: vinculo.id },
      data: { status: "Inativo" },
    });
    expect(await contarAdministradoresAtivos(conta.id)).toBe(1);
  });

  // A razão de a contagem exigir `Ativo` nos DOIS lados: quem foi banido da
  // plataforma não administra nada. Contá-lo deixaria a conta chegar a zero
  // administradores com a guarda achando que ainda havia um.
  test("identidade banida na plataforma não conta como administrador", async () => {
    const { conta, perfil } = await criarAmbiente();
    const segunda = await criarIdentidade();
    await criarVinculo(segunda.id, conta.id, perfil.id);
    expect(await contarAdministradoresAtivos(conta.id)).toBe(2);

    await db.usuario.update({
      where: { id: segunda.id },
      data: { status: "Inativo" },
    });

    expect(await contarAdministradoresAtivos(conta.id)).toBe(1);
  });

  test("vínculo ConvitePendente ainda não administra", async () => {
    const { conta, perfil } = await criarAmbiente();
    const convidada = await criarIdentidade();
    await criarVinculo(convidada.id, conta.id, perfil.id, {
      status: "ConvitePendente",
    });

    expect(await contarAdministradoresAtivos(conta.id)).toBe(1);
  });

  test("administrador de OUTRA conta não entra na contagem", async () => {
    const alfa = await criarAmbiente();
    await criarAmbiente();

    expect(await contarAdministradoresAtivos(alfa.conta.id)).toBe(1);
  });
});

describe("edição de usuário escopada pela conta (NFR2)", () => {
  test("não edita quem não tem vínculo nesta conta", async () => {
    const alfa = await criarAmbiente();
    const beta = await criarAmbiente();

    // A conta Alfa tentando editar alguém que só existe na Beta.
    const resultado = await atualizarUsuario(alfa.conta.id, beta.identidade.id, {
      nome: "Renomeado por outra conta",
    });

    expect(resultado).toBe(false);

    const intacto = await db.vinculoConta.findUniqueOrThrow({
      where: { id: beta.vinculo.id },
    });
    expect(intacto.nome).toBe(beta.vinculo.nome);
  });

  test("renomear escreve no VÍNCULO, nunca na identidade", async () => {
    const { conta, identidade, vinculo } = await criarAmbiente();
    const nomeOriginalDaIdentidade = identidade.nome;

    expect(
      await atualizarUsuario(conta.id, identidade.id, { nome: "Nome novo" }),
    ).toBe(true);

    const vinculoAtualizado = await db.vinculoConta.findUniqueOrThrow({
      where: { id: vinculo.id },
    });
    expect(vinculoAtualizado.nome).toBe("Nome novo");

    const identidadeIntacta = await db.usuario.findUniqueOrThrow({
      where: { id: identidade.id },
    });
    expect(identidadeIntacta.nome).toBe(nomeOriginalDaIdentidade);
  });

  // O e-mail é a chave global da identidade: trocá-lo afeta TODAS as contas
  // com que a pessoa tem vínculo. Uma conta não pode decidir isso sozinha.
  test("uma conta não muda o e-mail de quem atende várias", async () => {
    const identidade = await criarIdentidade({ email: "antes@teste.local" });

    const alfa = await criarConta({ nome: "Alfa" });
    await criarVinculo(identidade.id, alfa.id, (await criarPerfil(alfa.id)).id);
    const beta = await criarConta({ nome: "Beta" });
    await criarVinculo(identidade.id, beta.id, (await criarPerfil(beta.id)).id);

    const resultado = await atualizarUsuario(alfa.id, identidade.id, {
      email: "depois@teste.local",
    });

    expect(resultado).toBe(false);
    const inalterada = await db.usuario.findUniqueOrThrow({
      where: { id: identidade.id },
    });
    expect(inalterada.email).toBe("antes@teste.local");
  });

  test("com um vínculo só, a conta pode mudar o e-mail", async () => {
    const { conta, identidade } = await criarAmbiente();

    expect(
      await atualizarUsuario(conta.id, identidade.id, {
        email: "novo@teste.local",
      }),
    ).toBe(true);

    const atualizada = await db.usuario.findUniqueOrThrow({
      where: { id: identidade.id },
    });
    expect(atualizada.email).toBe("novo@teste.local");
  });
});

describe("promoção do convidado no primeiro login", () => {
  test("promove os DOIS lados, nunca só um", async () => {
    const conta = await criarConta();
    const perfil = await criarPerfil(conta.id);
    const identidade = await criarIdentidade({ status: "ConvitePendente" });
    await criarVinculo(identidade.id, conta.id, perfil.id, {
      status: "ConvitePendente",
    });

    expect(await ativarUsuarioConvidado(identidade.id, conta.id)).toEqual({
      count: 1,
    });

    const vinculo = await db.vinculoConta.findUniqueOrThrow({
      where: { usuarioId_contaId: { usuarioId: identidade.id, contaId: conta.id } },
    });
    const recarregada = await db.usuario.findUniqueOrThrow({
      where: { id: identidade.id },
    });

    // Promover só um lado é login bem-sucedido seguido de expulsão na
    // requisição seguinte, porque o acesso exige Ativo nos dois.
    expect(vinculo.status).toBe("Ativo");
    expect(recarregada.status).toBe("Ativo");
  });

  test("nunca promove quem foi desativado", async () => {
    const conta = await criarConta();
    const perfil = await criarPerfil(conta.id);
    const identidade = await criarIdentidade();
    await criarVinculo(identidade.id, conta.id, perfil.id, { status: "Inativo" });

    expect(await ativarUsuarioConvidado(identidade.id, conta.id)).toEqual({
      count: 0,
    });

    const vinculo = await db.vinculoConta.findUniqueOrThrow({
      where: { usuarioId_contaId: { usuarioId: identidade.id, contaId: conta.id } },
    });
    expect(vinculo.status).toBe("Inativo");
  });

  test("identidade banida não é promovida, nem parcialmente", async () => {
    const conta = await criarConta();
    const perfil = await criarPerfil(conta.id);
    const identidade = await criarIdentidade({ status: "Inativo" });
    await criarVinculo(identidade.id, conta.id, perfil.id, {
      status: "ConvitePendente",
    });

    expect(await ativarUsuarioConvidado(identidade.id, conta.id)).toEqual({
      count: 0,
    });

    // O vínculo NÃO pode ter sido promovido: seria deixar meia promoção
    // gravada para quem está banido.
    const vinculo = await db.vinculoConta.findUniqueOrThrow({
      where: { usuarioId_contaId: { usuarioId: identidade.id, contaId: conta.id } },
    });
    expect(vinculo.status).toBe("ConvitePendente");
  });

  // A CORRIDA de verdade, e não o caso que a leitura inicial já recusa: a
  // identidade é banida DEPOIS da leitura e ANTES da promoção da identidade.
  // Só esse caminho exerce o rollback — a primeira versão deste arquivo baniu
  // antes e passava mesmo com o rollback removido, ou seja, não testava nada.
  //
  // O gatilho abaixo é o que torna a corrida determinística: ele bane a
  // identidade no instante exato em que o vínculo é promovido, que é a janela
  // que um administrador concorrente ocuparia.
  test("identidade banida DURANTE a promoção desfaz o vínculo já promovido", async () => {
    const conta = await criarConta();
    const perfil = await criarPerfil(conta.id);
    const identidade = await criarIdentidade({ status: "ConvitePendente" });
    await criarVinculo(identidade.id, conta.id, perfil.id, {
      status: "ConvitePendente",
    });

    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION banir_durante_promocao() RETURNS TRIGGER AS $$
      BEGIN
        UPDATE "usuarios" SET "status" = 'Inativo' WHERE "id" = NEW."usuarioId";
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER banir_durante_promocao_trigger
      AFTER UPDATE ON "vinculos_de_conta"
      FOR EACH ROW EXECUTE FUNCTION banir_durante_promocao();
    `);

    try {
      expect(await ativarUsuarioConvidado(identidade.id, conta.id)).toEqual({
        count: 0,
      });

      // O ponto todo: a transação inteira voltou atrás. Sem o rollback, o
      // vínculo ficaria "Ativo" para uma identidade banida.
      const vinculo = await db.vinculoConta.findUniqueOrThrow({
        where: { usuarioId_contaId: { usuarioId: identidade.id, contaId: conta.id } },
      });
      expect(vinculo.status).toBe("ConvitePendente");
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS banir_durante_promocao_trigger ON "vinculos_de_conta"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS banir_durante_promocao()`);
    }
  });

  test("sem vínculo com a conta, não promove nada", async () => {
    const identidade = await criarIdentidade();
    const conta = await criarConta();

    expect(await ativarUsuarioConvidado(identidade.id, conta.id)).toEqual({
      count: 0,
    });
  });

  test("é idempotente para quem já está ativo", async () => {
    const { conta, identidade } = await criarAmbiente();

    expect(await ativarUsuarioConvidado(identidade.id, conta.id)).toEqual({
      count: 1,
    });
    expect(await ativarUsuarioConvidado(identidade.id, conta.id)).toEqual({
      count: 1,
    });
  });
});

// A regressão nomeada na revisão da Story 6.7: sem o filtro de status, uma
// identidade banida com cookie ainda válido criaria e editaria qualquer conta
// da plataforma.
describe("identidade ativa (gate do operador de plataforma, AD-13)", () => {
  test("identidade banida não é resolvida", async () => {
    const identidade = await criarIdentidade({
      status: "Inativo",
      isPlataformaOperador: true,
    });

    expect(await buscarIdentidadeAtiva(identidade.id)).toBeNull();
  });

  test("identidade ativa é resolvida com o flag de operador", async () => {
    const identidade = await criarIdentidade({ isPlataformaOperador: true });

    const resolvida = await buscarIdentidadeAtiva(identidade.id);
    expect(resolvida?.isPlataformaOperador).toBe(true);
  });

  test("ser operador de plataforma independe de vínculo e de perfil", async () => {
    // AD-13: o gate é a identidade, nunca can()/PerfilAcesso. Um operador sem
    // vínculo nenhum continua sendo operador.
    const identidade = await criarIdentidade({ isPlataformaOperador: true });

    const resolvida = await buscarIdentidadeAtiva(identidade.id);
    expect(resolvida?.isPlataformaOperador).toBe(true);
    expect(await db.vinculoConta.count({ where: { usuarioId: identidade.id } })).toBe(0);
  });
});
