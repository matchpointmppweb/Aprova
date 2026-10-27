import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  ERRO_RESPONSAVEL_INATIVO,
  ERRO_RESPONSAVEL_INVALIDO,
  opcoesDeResponsavel,
  validarResponsavel,
} from "@/src/lib/responsavel";

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

const { criarEmissaoAction, editarEmissaoAction } = await import("@/src/server/actions/emissao");

import { criarEmissaoCompleta, db, limparBanco } from "./setup/fixtures";

beforeEach(limparBanco);

// Diferido da Story 6.3, fechado em 27-10-2026: uma pessoa DESATIVADA na
// conta continuava selecionável como responsável e era aceita na gravação —
// `listarUsuarios` devolve os três status de propósito, e a validação só
// conferia pertencimento.
//
// O que estes testes prendem não é só a recusa: é a EXCEÇÃO que a acompanha.
// Barrar o inativo sem preservar quem já está gravado repetiria o defeito
// mais caro do Epic 7 (Story 7.5), em que arquivar o plano tornava a emissão
// permanentemente ineditável.

const ATIVO = { id: "u-ativa", status: "Ativo" as const };
const INATIVO = { id: "u-inativa", status: "Inativo" as const };
const CONVIDADO = { id: "u-convite", status: "ConvitePendente" as const };
const TODOS = [ATIVO, INATIVO, CONVIDADO];

describe("opcoesDeResponsavel", () => {
  test("oferece só quem está Ativo", () => {
    // ConvitePendente fica DE FORA de propósito: ainda não entrou no
    // sistema, e atribuir responsabilidade a quem não aceitou o convite é
    // prometer o que não se tem. É o vizinho que distingue esta regra de um
    // simples "status !== Inativo".
    expect(opcoesDeResponsavel(TODOS, null).map((u) => u.id)).toEqual([ATIVO.id]);
  });

  test("mantém o responsável JÁ gravado, mesmo inativo", () => {
    expect(opcoesDeResponsavel(TODOS, INATIVO.id).map((u) => u.id)).toEqual([
      ATIVO.id,
      INATIVO.id,
    ]);
  });

  test("não duplica quando o já gravado também está ativo", () => {
    expect(opcoesDeResponsavel(TODOS, ATIVO.id).map((u) => u.id)).toEqual([ATIVO.id]);
  });
});

describe("validarResponsavel", () => {
  test("aceita quem está Ativo", () => {
    expect(validarResponsavel(TODOS, ATIVO.id, null)).toEqual([]);
  });

  test("recusa quem está inativo, com mensagem acionável", () => {
    const erros = validarResponsavel(TODOS, INATIVO.id, null);
    expect(erros).toHaveLength(1);
    expect(erros[0].field).toBe("responsavelId");
    expect(erros[0].message).toBe(ERRO_RESPONSAVEL_INATIVO);
  });

  test("quem não é da conta é 'inválido', não 'inativo'", () => {
    // Mensagens DIFERENTES de propósito: dizer "está inativo" sobre um id de
    // outra conta confirmaria que ele existe em algum lugar (AD-1).
    const erros = validarResponsavel(TODOS, "de-outra-conta", null);
    expect(erros[0].message).toBe(ERRO_RESPONSAVEL_INVALIDO);
  });

  test("o responsável JÁ gravado continua aceito mesmo inativo", () => {
    expect(validarResponsavel(TODOS, INATIVO.id, INATIVO.id)).toEqual([]);
  });

  test("mas TROCAR para outro inativo é recusado", () => {
    // A exceção vale para o histórico, não para a escolha: com ela larga
    // demais, bastaria uma emissão qualquer para destravar todos os
    // inativos.
    const outroInativo = { id: "u-inativa-2", status: "Inativo" as const };
    const erros = validarResponsavel([...TODOS, outroInativo], outroInativo.id, INATIVO.id);
    expect(erros[0].message).toBe(ERRO_RESPONSAVEL_INATIVO);
  });

  test("responsável vazio não é erro aqui — é campo obrigatório, de outra validação", () => {
    expect(validarResponsavel(TODOS, "", null)).toEqual([]);
  });
});

describe("a Server Action de emissão aplica a regra", () => {
  async function cenarioComInativo() {
    const cenario = await criarEmissaoCompleta();
    sessaoDeTeste.usuario = {
      id: cenario.identidade.id,
      contaId: cenario.conta.id,
      perfilAcessoId: cenario.perfil.id,
    };
    return cenario;
  }

  function formDeEmissao(cenario: { ativo: { id: string } }, responsavelId: string) {
    const formData = new FormData();
    formData.set("ativoId", cenario.ativo.id);
    formData.set("responsavelId", responsavelId);
    formData.set("setor", "Manutencao");
    return formData;
  }

  test("criar com responsável desativado é RECUSADO e nada é gravado", async () => {
    const cenario = await cenarioComInativo();
    await db.vinculoConta.updateMany({
      where: { contaId: cenario.conta.id, usuarioId: cenario.identidade.id },
      data: { status: "Inativo" },
    });

    const antes = await db.emissao.count({ where: { contaId: cenario.conta.id } });
    const estado = await criarEmissaoAction(
      { ok: false },
      formDeEmissao(cenario, cenario.identidade.id),
    );

    expect(estado.ok).toBe(false);
    expect(await db.emissao.count({ where: { contaId: cenario.conta.id } })).toBe(antes);
  });

  test("editar uma emissão cujo responsável foi desativado DEPOIS continua possível", async () => {
    const cenario = await cenarioComInativo();
    // A emissão já existe com este responsável; a desativação vem depois.
    // Este é o caso que a regra NÃO pode quebrar — é o defeito da 7.5 em
    // outra tela.
    await db.vinculoConta.updateMany({
      where: { contaId: cenario.conta.id, usuarioId: cenario.identidade.id },
      data: { status: "Inativo" },
    });

    const emissao = await db.emissao.findUniqueOrThrow({ where: { id: cenario.emissao.id } });
    const formData = formDeEmissao(cenario, cenario.identidade.id);
    formData.set("emissaoId", emissao.id);
    formData.set("updatedAt", emissao.updatedAt.toISOString());
    formData.set("setor", "Producao");

    const estado = await editarEmissaoAction({ ok: false }, formData);

    expect(estado.ok).toBe(true);
    const relida = await db.emissao.findUniqueOrThrow({ where: { id: emissao.id } });
    expect(relida.setor).toBe("Producao");
  });
});
