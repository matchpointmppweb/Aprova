import { beforeEach, describe, expect, test } from "vitest";

import {
  provisionarContaEm,
  ProvisionamentoInconsistenteError,
  OPCOES_DE_TRANSACAO_DE_PROVISIONAMENTO,
  type DadosDaConta,
} from "@/src/server/repositories/provisionamento";
import {
  MODULOS_COM_PERMISSAO,
  PERFIS_PADRAO,
  NOME_ADMINISTRADOR,
} from "@/src/server/perfis-padrao";
import { prisma } from "@/src/server/repositories/db";

import { criarIdentidade, db, limparBanco } from "./setup/fixtures";

beforeEach(limparBanco);

const CONTA: DadosDaConta = {
  nome: "Cliente Novo",
  cnpj: "11.111.111/0001-11",
  planoContratado: "Essencial",
  status: "Ativa",
};

const ADMIN = { nome: "Primeiro Admin", email: "admin@cliente-novo.local" };

function provisionar(
  conta: Partial<DadosDaConta> = {},
  administrador: Partial<typeof ADMIN> = {},
) {
  return prisma.$transaction(
    (tx) =>
      provisionarContaEm(tx, {
        conta: { ...CONTA, ...conta },
        administrador: { ...ADMIN, ...administrador },
      }),
    OPCOES_DE_TRANSACAO_DE_PROVISIONAMENTO,
  );
}

// Fecha a lacuna aberta desde a Story 1.4: uma conta criada pela área de
// plataforma nascia SEM perfis e SEM ninguém capaz de entrar, e só era
// destravada por intervenção manual no banco.
describe("provisionamento de conta (FR25/AD-27)", () => {
  test("a conta nasce com os perfis padrão e o administrador vinculado", async () => {
    const resultado = await provisionar();

    const perfis = await db.perfilAcesso.findMany({
      where: { contaId: resultado.conta.id },
      orderBy: { nome: "asc" },
    });
    expect(perfis.map((p) => p.nome).sort()).toEqual(
      PERFIS_PADRAO.map((p) => p.nome).sort(),
    );

    const vinculos = await db.vinculoConta.findMany({
      where: { contaId: resultado.conta.id },
      include: { usuario: true, perfilAcesso: true },
    });
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0].usuario.email).toBe(ADMIN.email);
    expect(vinculos[0].perfilAcesso.nome).toBe(NOME_ADMINISTRADOR);
    expect(vinculos[0].nome).toBe(ADMIN.nome);
  });

  // A regressão que motivou a story: um módulo novo no enum passava a existir
  // sem linha de permissão, ficando invisível e inconfigurável até um backfill
  // manual. Aqui a garantia é conferida contra o enum, não contra uma lista
  // escrita à mão.
  test("todo perfil padrão tem permissão de TODOS os módulos configuráveis", async () => {
    const resultado = await provisionar();

    for (const perfil of resultado.perfis) {
      const permissoes = await db.permissaoModulo.findMany({
        where: { perfilAcessoId: perfil.id },
      });
      expect(
        permissoes.map((p) => p.modulo).sort(),
        `perfil ${perfil.nome}`,
      ).toEqual([...MODULOS_COM_PERMISSAO].sort());
    }
  });

  // AD-9: ou tudo, ou nada. Antes disso uma falha no meio deixava conta órfã.
  test("falha no meio não grava NADA", async () => {
    await provisionar({ cnpj: "22.222.222/0001-22" });

    const contasAntes = await db.conta.count();
    const perfisAntes = await db.perfilAcesso.count();
    const usuariosAntes = await db.usuario.count();

    // Mesmo CNPJ: a criação da conta falha, e o resto nem chega a rodar.
    await expect(
      provisionar(
        { cnpj: "22.222.222/0001-22", nome: "Duplicata" },
        { email: "outro@cliente.local" },
      ),
    ).rejects.toThrow();

    expect(await db.conta.count()).toBe(contasAntes);
    expect(await db.perfilAcesso.count()).toBe(perfisAntes);
    expect(await db.usuario.count()).toBe(usuariosAntes);
    expect(await db.conta.findFirst({ where: { nome: "Duplicata" } })).toBeNull();
  });

  // Regra da Story 6.6 herdada: identidade global. Um e-mail que já existe na
  // plataforma NÃO é recriado nem tem a senha tocada — ganha só o vínculo novo.
  test("e-mail já existente na plataforma ganha só o vínculo novo", async () => {
    const existente = await criarIdentidade({
      nome: "Nome que a outra conta digitou",
      email: "compartilhado@teste.local",
    });

    const resultado = await provisionar(
      { cnpj: "33.333.333/0001-33" },
      { nome: "Nome nesta conta", email: "compartilhado@teste.local" },
    );

    expect(resultado.identidadeNova).toBe(false);

    const identidades = await db.usuario.findMany({
      where: { email: "compartilhado@teste.local" },
    });
    expect(identidades).toHaveLength(1);
    expect(identidades[0].id).toBe(existente.id);
    // A identidade NÃO é renomeada pela conta nova.
    expect(identidades[0].nome).toBe("Nome que a outra conta digitou");

    // Mas o nome DESTA conta é o do vínculo.
    const vinculo = await db.vinculoConta.findFirst({
      where: { contaId: resultado.conta.id, usuarioId: existente.id },
    });
    expect(vinculo?.nome).toBe("Nome nesta conta");
  });

  test("identidade sem credencial recebe convite para definir senha", async () => {
    const resultado = await provisionar({ cnpj: "44.444.444/0001-44" });
    expect(resultado.enviarDefinicaoDeSenha).toBe(true);
  });

  test("identidade que já tem credencial não recebe definição de senha", async () => {
    const existente = await criarIdentidade({ email: "comsenha@teste.local" });
    await db.account.create({
      data: {
        userId: existente.id,
        providerId: "credential",
        accountId: existente.id,
        password: "hash-ficticio",
      },
    });

    const resultado = await provisionar(
      { cnpj: "55.555.555/0001-55" },
      { email: "comsenha@teste.local" },
    );

    expect(resultado.enviarDefinicaoDeSenha).toBe(false);
  });

  test("a matriz de perfis padrão contém o perfil Administrador", () => {
    // Guarda de sanidade da própria matriz: sem ele, TODA conta nova aborta
    // com ProvisionamentoInconsistenteError.
    expect(PERFIS_PADRAO.some((p) => p.nome === NOME_ADMINISTRADOR)).toBe(true);
    expect(ProvisionamentoInconsistenteError.prototype).toBeInstanceOf(Error);
  });
});
