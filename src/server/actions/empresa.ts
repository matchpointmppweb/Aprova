"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { atualizarEmpresa, criarEmpresa } from "@/src/server/repositories/empresa";
import type { EstadoAcaoEmpresa } from "./empresa-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

// Nunca expõe detalhe de constraint (Boundaries) — só reconhece a violação
// da constraint única @@unique([contaId, razaoSocial]) para traduzir num
// erro de validação de campo.
function isErroDeNomeDuplicado(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

// cnpj/cpf/observacao são opcionais e sem validação de dígito verificador
// (Boundaries) — string vazia vira `null`, nunca bloqueia o submit.
function lerCampos(formData: FormData) {
  const razaoSocial = String(formData.get("razaoSocial") ?? "").trim();
  const nomeFantasia = String(formData.get("nomeFantasia") ?? "").trim();
  const cnpjBruto = String(formData.get("cnpj") ?? "").trim();
  const cpfBruto = String(formData.get("cpf") ?? "").trim();
  const observacaoBruta = String(formData.get("observacao") ?? "").trim();
  return {
    razaoSocial,
    nomeFantasia,
    cnpj: cnpjBruto ? cnpjBruto : null,
    cpf: cpfBruto ? cpfBruto : null,
    observacao: observacaoBruta ? observacaoBruta : null,
  };
}

// Given usuário autenticado com can(criar,'empresas'), when cria uma empresa
// com razão social/nome fantasia e CNPJ e/ou CPF -> Empresa é gravada
// escopada pela própria conta (AD-1); sem coluna de status e sem ação de
// excluir nesta tela (Boundaries/AD-17).
export async function criarEmpresaAction(
  _estadoAnterior: EstadoAcaoEmpresa,
  formData: FormData,
): Promise<EstadoAcaoEmpresa> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, mesmo que a
  // UI já esconda/desabilite o botão "Nova empresa".
  const autorizado = await can(usuarioSessao, "criar", "empresas");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const { razaoSocial, nomeFantasia, cnpj, cpf, observacao } = lerCampos(formData);

  const erros: { field: string; message: string }[] = [];
  if (!razaoSocial) erros.push({ field: "razaoSocial", message: "Informe a razão social." });
  if (!nomeFantasia) erros.push({ field: "nomeFantasia", message: "Informe o nome fantasia." });
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  try {
    await criarEmpresa(usuarioSessao.contaId, { razaoSocial, nomeFantasia, cnpj, cpf, observacao });
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "razaoSocial", message: "Já existe uma empresa com essa razão social." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/empresas");
  return { ok: true };
}

// Given usuário autenticado com can(editar,'empresas'), when edita qualquer
// campo de uma empresa existente da própria conta -> dados são atualizados e
// refletidos na listagem (Boundaries — não há ação "excluir" separada nesta
// tela). Um id de Empresa de outra conta nunca é encontrado (updateMany
// escopado por {id,contaId}, AD-1) e não vaza a existência do registro (I/O
// Matrix).
export async function editarEmpresaAction(
  _estadoAnterior: EstadoAcaoEmpresa,
  formData: FormData,
): Promise<EstadoAcaoEmpresa> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "empresas");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const empresaId = String(formData.get("empresaId") ?? "").trim();
  const { razaoSocial, nomeFantasia, cnpj, cpf, observacao } = lerCampos(formData);

  const erros: { field: string; message: string }[] = [];
  if (!empresaId) erros.push({ field: "empresaId", message: "Empresa inválida." });
  if (!razaoSocial) erros.push({ field: "razaoSocial", message: "Informe a razão social." });
  if (!nomeFantasia) erros.push({ field: "nomeFantasia", message: "Informe o nome fantasia." });
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarEmpresa(usuarioSessao.contaId, empresaId, {
      razaoSocial,
      nomeFantasia,
      cnpj,
      cpf,
      observacao,
    });
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "razaoSocial", message: "Já existe uma empresa com essa razão social." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Empresa não encontrada nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/empresas");
  return { ok: true };
}
