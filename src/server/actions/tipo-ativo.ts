"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type StatusTipoAtivo } from "@prisma/client";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import {
  atualizarTipoAtivo,
  criarTipoAtivo,
} from "@/src/server/repositories/tipo-ativo";
import type { EstadoAcaoTipoAtivo } from "./tipo-ativo-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

const STATUS_VALIDOS: StatusTipoAtivo[] = ["Ativo", "Arquivado"];

// Nunca expõe detalhe de constraint (Boundaries) — só reconhece a violação
// da constraint única @@unique([contaId, nome]) para traduzir num erro de
// validação de campo.
function isErroDeNomeDuplicado(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

function lerCampos(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const descricaoBruta = String(formData.get("descricao") ?? "").trim();
  const statusBruto = String(formData.get("status") ?? "").trim();
  return {
    nome,
    descricao: descricaoBruta ? descricaoBruta : null,
    status: statusBruto,
  };
}

// Given usuário autenticado com can(criar,'tipos'), when cria um tipo com
// nome/descrição/status -> TipoAtivo é gravado escopado pela própria conta
// (AD-1) e aparece na listagem com contagem de ativos vinculados fixa em 0
// (Intent/Boundaries — Ativo só nasce na Story 2.2).
export async function criarTipoAtivoAction(
  _estadoAnterior: EstadoAcaoTipoAtivo,
  formData: FormData,
): Promise<EstadoAcaoTipoAtivo> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, mesmo que a
  // UI já esconda/desabilite o botão "Novo tipo".
  const autorizado = await can(usuarioSessao, "criar", "tipos");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const { nome, descricao, status } = lerCampos(formData);

  const erros: { field: string; message: string }[] = [];
  if (!nome) erros.push({ field: "nome", message: "Informe o nome do tipo." });
  if (!STATUS_VALIDOS.includes(status as StatusTipoAtivo)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  try {
    await criarTipoAtivo(usuarioSessao.contaId, {
      nome,
      descricao,
      status: status as StatusTipoAtivo,
    });
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "nome", message: "Já existe um tipo com esse nome." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/tipos");
  return { ok: true };
}

// Given usuário autenticado com can(editar,'tipos'), when edita nome/
// descrição/status de um tipo existente da própria conta -> dados são
// atualizados e refletidos na listagem/filtro; "arquivar" é só mudar status
// para Arquivado por este mesmo formulário (Boundaries — não há ação
// "excluir" separada nesta tela). Um id de TipoAtivo de outra conta nunca é
// encontrado (updateMany escopado por {id,contaId}, AD-1) e não vaza a
// existência do registro (I/O Matrix).
export async function editarTipoAtivoAction(
  _estadoAnterior: EstadoAcaoTipoAtivo,
  formData: FormData,
): Promise<EstadoAcaoTipoAtivo> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "tipos");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const tipoAtivoId = String(formData.get("tipoAtivoId") ?? "").trim();
  const { nome, descricao, status } = lerCampos(formData);

  const erros: { field: string; message: string }[] = [];
  if (!tipoAtivoId) erros.push({ field: "tipoAtivoId", message: "Tipo inválido." });
  if (!nome) erros.push({ field: "nome", message: "Informe o nome do tipo." });
  if (!STATUS_VALIDOS.includes(status as StatusTipoAtivo)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarTipoAtivo(usuarioSessao.contaId, tipoAtivoId, {
      nome,
      descricao,
      status: status as StatusTipoAtivo,
    });
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "nome", message: "Já existe um tipo com esse nome." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Tipo não encontrado nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/tipos");
  return { ok: true };
}
