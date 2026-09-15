"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type StatusLocal } from "@prisma/client";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import {
  atualizarLocal,
  criarLocal,
  type AreaPoligono,
} from "@/src/server/repositories/local";
import type { EstadoAcaoLocal } from "./local-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

const STATUS_VALIDOS: StatusLocal[] = ["Ativo", "Inativo"];

// Nunca expõe detalhe de constraint (Boundaries) — só reconhece a violação
// da constraint única @@unique([contaId, nome]) para traduzir num erro de
// validação de campo.
function isErroDeNomeDuplicado(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

// Parse seguro de areaPoligono (Code Map): string JSON vinda do campo
// oculto do editor de mapa. Ausente ou inválido vira `null` — nunca um erro
// de validação bloqueante (Boundaries: o polígono nunca é obrigatório).
function lerAreaPoligono(formData: FormData): AreaPoligono {
  const bruto = formData.get("areaPoligono");
  if (typeof bruto !== "string" || !bruto.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(bruto);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const pontos = parsed.filter(
      (ponto): ponto is { x: number; y: number } =>
        !!ponto &&
        typeof ponto === "object" &&
        typeof (ponto as { x?: unknown }).x === "number" &&
        typeof (ponto as { y?: unknown }).y === "number",
    );
    return pontos.length >= 3 ? pontos : null;
  } catch {
    return null;
  }
}

function lerCampos(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const endereco = String(formData.get("endereco") ?? "").trim();
  const statusBruto = String(formData.get("status") ?? "").trim();
  return {
    nome,
    endereco,
    status: statusBruto,
    areaPoligono: lerAreaPoligono(formData),
  };
}

// Given usuário autenticado com can(criar,'locais'), when cria um local com
// nome/endereço/status (e opcionalmente um polígono desenhado no editor) ->
// Local é gravado escopado pela própria conta (AD-1); sem polígono desenhado,
// areaPoligono é gravado como null (Boundaries — nunca obrigatório).
export async function criarLocalAction(
  _estadoAnterior: EstadoAcaoLocal,
  formData: FormData,
): Promise<EstadoAcaoLocal> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, mesmo que a
  // UI já esconda/desabilite o botão "Novo local".
  const autorizado = await can(usuarioSessao, "criar", "locais");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const { nome, endereco, status, areaPoligono } = lerCampos(formData);

  const erros: { field: string; message: string }[] = [];
  if (!nome) erros.push({ field: "nome", message: "Informe o nome do local." });
  if (!endereco) erros.push({ field: "endereco", message: "Informe o endereço do local." });
  if (!STATUS_VALIDOS.includes(status as StatusLocal)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  try {
    await criarLocal(usuarioSessao.contaId, {
      nome,
      endereco,
      areaPoligono,
      status: status as StatusLocal,
    });
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "nome", message: "Já existe um local com esse nome." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/locais");
  return { ok: true };
}

// Given usuário autenticado com can(editar,'locais'), when edita nome/
// endereço/status/polígono de um local existente da própria conta -> dados
// são atualizados e refletidos na listagem/filtro; "inativar" é só mudar
// status para Inativo por este mesmo formulário (Boundaries — não há ação
// "excluir" separada nesta tela). Um id de Local de outra conta nunca é
// encontrado (updateMany escopado por {id,contaId}, AD-1) e não vaza a
// existência do registro (I/O Matrix).
export async function editarLocalAction(
  _estadoAnterior: EstadoAcaoLocal,
  formData: FormData,
): Promise<EstadoAcaoLocal> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "locais");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const localId = String(formData.get("localId") ?? "").trim();
  const { nome, endereco, status, areaPoligono } = lerCampos(formData);

  const erros: { field: string; message: string }[] = [];
  if (!localId) erros.push({ field: "localId", message: "Local inválido." });
  if (!nome) erros.push({ field: "nome", message: "Informe o nome do local." });
  if (!endereco) erros.push({ field: "endereco", message: "Informe o endereço do local." });
  if (!STATUS_VALIDOS.includes(status as StatusLocal)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarLocal(usuarioSessao.contaId, localId, {
      nome,
      endereco,
      areaPoligono,
      status: status as StatusLocal,
    });
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "nome", message: "Já existe um local com esse nome." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Local não encontrado nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/locais");
  return { ok: true };
}
