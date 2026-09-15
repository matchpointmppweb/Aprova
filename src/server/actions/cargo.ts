"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type StatusCargo } from "@prisma/client";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { atualizarCargo, criarCargo } from "@/src/server/repositories/cargo";
import type { EstadoAcaoCargo } from "./cargo-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

const STATUS_VALIDOS: StatusCargo[] = ["Ativo", "Inativo"];

// Nunca expõe detalhe de constraint (Boundaries) — só reconhece a violação
// da constraint única @@unique([contaId, descricao]) para traduzir num erro
// de validação de campo.
function isErroDeDescricaoDuplicada(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

function lerCampos(formData: FormData) {
  const descricao = String(formData.get("descricao") ?? "").trim();
  const statusBruto = String(formData.get("status") ?? "").trim();
  return { descricao, status: statusBruto };
}

// Given usuário autenticado com can(criar,'cargos'), when cria um cargo com
// descrição+status -> Cargo é gravado escopado pela própria conta (AD-1).
export async function criarCargoAction(
  _estadoAnterior: EstadoAcaoCargo,
  formData: FormData,
): Promise<EstadoAcaoCargo> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, mesmo que a
  // UI já esconda/desabilite o botão "Novo cargo".
  const autorizado = await can(usuarioSessao, "criar", "cargos");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const { descricao, status } = lerCampos(formData);

  const erros: { field: string; message: string }[] = [];
  if (!descricao) erros.push({ field: "descricao", message: "Informe a descrição do cargo." });
  if (!STATUS_VALIDOS.includes(status as StatusCargo)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  try {
    await criarCargo(usuarioSessao.contaId, {
      descricao,
      status: status as StatusCargo,
    });
  } catch (erro) {
    if (isErroDeDescricaoDuplicada(erro)) {
      return {
        ok: false,
        error: [{ field: "descricao", message: "Já existe um cargo com essa descrição." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/cargos");
  return { ok: true };
}

// Given usuário autenticado com can(editar,'cargos'), when edita descrição/
// status de um cargo existente da própria conta -> dados são atualizados e
// refletidos na listagem/filtro; "inativar" é só mudar status para Inativo
// por este mesmo formulário (Boundaries — não há ação "excluir" separada
// nesta tela). Um id de Cargo de outra conta nunca é encontrado (updateMany
// escopado por {id,contaId}, AD-1) e não vaza a existência do registro (I/O
// Matrix).
export async function editarCargoAction(
  _estadoAnterior: EstadoAcaoCargo,
  formData: FormData,
): Promise<EstadoAcaoCargo> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "cargos");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const cargoId = String(formData.get("cargoId") ?? "").trim();
  const { descricao, status } = lerCampos(formData);

  const erros: { field: string; message: string }[] = [];
  if (!cargoId) erros.push({ field: "cargoId", message: "Cargo inválido." });
  if (!descricao) erros.push({ field: "descricao", message: "Informe a descrição do cargo." });
  if (!STATUS_VALIDOS.includes(status as StatusCargo)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarCargo(usuarioSessao.contaId, cargoId, {
      descricao,
      status: status as StatusCargo,
    });
  } catch (erro) {
    if (isErroDeDescricaoDuplicada(erro)) {
      return {
        ok: false,
        error: [{ field: "descricao", message: "Já existe um cargo com essa descrição." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Cargo não encontrado nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/cargos");
  return { ok: true };
}
