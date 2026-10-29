"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type StatusFuncao } from "@prisma/client";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { atualizarFuncao, criarFuncao } from "@/src/server/repositories/funcao";
import type { EstadoAcaoFuncao } from "./funcao-estado";
import { LIMITE_DESCRICAO, lerTexto, validarTamanho } from "@/src/lib/texto";
import { registrarFalha } from "@/src/server/log";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

const STATUS_VALIDOS: StatusFuncao[] = ["Ativo", "Inativo"];

// Nunca expõe detalhe de constraint (Boundaries) — só reconhece a violação
// da constraint única @@unique([contaId, descricao]) para traduzir num erro
// de validação de campo.
function isErroDeDescricaoDuplicada(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

function lerCampos(formData: FormData) {
  const descricao = lerTexto(formData, "descricao");
  const statusBruto = lerTexto(formData, "status");
  return { descricao, status: statusBruto };
}

// Given usuário autenticado com can(criar,'funcoes'), when cria uma função
// com descrição+status -> Funcao é gravada escopada pela própria conta
// (AD-1).
export async function criarFuncaoAction(
  _estadoAnterior: EstadoAcaoFuncao,
  formData: FormData,
): Promise<EstadoAcaoFuncao> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, mesmo que a
  // UI já esconda/desabilite o botão "Nova função".
  const autorizado = await can(usuarioSessao, "criar", "funcoes");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const { descricao, status } = lerCampos(formData);

  const erros: { field: string; message: string }[] = [];

  // Teto de tamanho (src/lib/texto.ts): recusa, nunca trunca.
  erros.push(...validarTamanho(descricao, LIMITE_DESCRICAO, "descricao", "Descrição"));
  if (!descricao) erros.push({ field: "descricao", message: "Informe a descrição da função." });
  if (!STATUS_VALIDOS.includes(status as StatusFuncao)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  try {
    await criarFuncao(usuarioSessao.contaId, {
      descricao,
      status: status as StatusFuncao,
    });
  } catch (erro) {
    if (isErroDeDescricaoDuplicada(erro)) {
      return {
        ok: false,
        error: [{ field: "descricao", message: "Já existe uma função com essa descrição." }],
      };
    }
    // Rastro da falha INESPERADA (src/server/log.ts): a resposta ao
    // usuário continua genérica, mas o erro deixa de desaparecer.
    registrarFalha({ operacao: "criarFuncaoAction", contaId: usuarioSessao.contaId }, erro);
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/funcoes");
  return { ok: true };
}

// Given usuário autenticado com can(editar,'funcoes'), when edita descrição/
// status de uma função existente da própria conta -> dados são atualizados
// e refletidos na listagem/filtro; "inativar" é só mudar status para
// Inativo por este mesmo formulário (Boundaries — não há ação "excluir"
// separada nesta tela). Um id de Funcao de outra conta nunca é encontrado
// (updateMany escopado por {id,contaId}, AD-1) e não vaza a existência do
// registro (I/O Matrix).
export async function editarFuncaoAction(
  _estadoAnterior: EstadoAcaoFuncao,
  formData: FormData,
): Promise<EstadoAcaoFuncao> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "funcoes");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const funcaoId = lerTexto(formData, "funcaoId");
  const { descricao, status } = lerCampos(formData);

  const erros: { field: string; message: string }[] = [];

  // Teto de tamanho (src/lib/texto.ts): recusa, nunca trunca.
  erros.push(...validarTamanho(descricao, LIMITE_DESCRICAO, "descricao", "Descrição"));
  if (!funcaoId) erros.push({ field: "funcaoId", message: "Função inválida." });
  if (!descricao) erros.push({ field: "descricao", message: "Informe a descrição da função." });
  if (!STATUS_VALIDOS.includes(status as StatusFuncao)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarFuncao(usuarioSessao.contaId, funcaoId, {
      descricao,
      status: status as StatusFuncao,
    });
  } catch (erro) {
    if (isErroDeDescricaoDuplicada(erro)) {
      return {
        ok: false,
        error: [{ field: "descricao", message: "Já existe uma função com essa descrição." }],
      };
    }
    // Rastro da falha INESPERADA (src/server/log.ts): a resposta ao
    // usuário continua genérica, mas o erro deixa de desaparecer.
    registrarFalha({ operacao: "editarFuncaoAction", contaId: usuarioSessao.contaId }, erro);
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Função não encontrada nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/funcoes");
  return { ok: true };
}
