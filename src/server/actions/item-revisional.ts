"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type StatusItemRevisional } from "@prisma/client";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import {
  atualizarItemRevisional,
  criarItemRevisional,
} from "@/src/server/repositories/item-revisional";
import {
  validarControlesDeItemRevisional,
  type EstadoAcaoItemRevisional,
} from "./item-revisional-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
// Nunca expõe detalhe de constraint/banco (Boundaries).
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

const STATUS_VALIDOS: StatusItemRevisional[] = ["Ativo", "Arquivado"];

// Nunca expõe detalhe de constraint (Boundaries) — só reconhece a violação
// da constraint única @@unique([contaId, nome]) para traduzir num erro de
// validação de campo. Mesmo padrão de src/server/actions/tipo-ativo.ts.
function isErroDeNomeDuplicado(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

// Campo numérico opcional: string vazia -> null; string presente -> Number.
// Valores inválidos (NaN) são tratados como null pela leitura e pegos pela
// validação de "ao menos 1 de 3, positivo" em
// validarControlesDeItemRevisional (item-revisional-estado.ts).
function lerCampoNumerico(formData: FormData, nome: string): number | null {
  const bruto = String(formData.get(nome) ?? "").trim();
  if (!bruto) return null;
  const valor = Number(bruto);
  // Number.isInteger rejeita decimais (ex. "90.5") aqui, na validação, em
  // vez de deixar passar até o limite Int do Prisma/Postgres, onde só
  // gerava o erro genérico ERRO_GENERICO sem explicar a causa real.
  return Number.isFinite(valor) && Number.isInteger(valor) ? valor : null;
}

function lerCampos(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const descricaoBruta = String(formData.get("descricao") ?? "").trim();
  const statusBruto = String(formData.get("status") ?? "").trim();
  return {
    nome,
    descricao: descricaoBruta ? descricaoBruta : null,
    diasPadrao: lerCampoNumerico(formData, "diasPadrao"),
    kmPadrao: lerCampoNumerico(formData, "kmPadrao"),
    horasPadrao: lerCampoNumerico(formData, "horasPadrao"),
    status: statusBruto,
  };
}

function validarCampos(campos: {
  nome: string;
  status: string;
  diasPadrao: number | null;
  kmPadrao: number | null;
  horasPadrao: number | null;
}) {
  const erros: { field: string; message: string }[] = [];
  if (!campos.nome) {
    erros.push({ field: "nome", message: "Informe o nome do item revisional." });
  }
  if (!STATUS_VALIDOS.includes(campos.status as StatusItemRevisional)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }
  erros.push(...validarControlesDeItemRevisional(campos));
  return erros;
}

// Given usuário autenticado com can(criar,'itens'), when cria um item com
// nome/descrição e ao menos um controle de medição preenchido -> item é
// gravado escopado pela própria conta (AD-1) e aparece na listagem com os
// badges dos controles selecionados (I/O Matrix).
export async function criarItemRevisionalAction(
  _estadoAnterior: EstadoAcaoItemRevisional,
  formData: FormData,
): Promise<EstadoAcaoItemRevisional> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, mesmo que a
  // UI já esconda/desabilite o botão "Novo item". Gate próprio de
  // 'criar' — nunca reaproveita o resultado de 'editar'/'excluir'.
  const autorizado = await can(usuarioSessao, "criar", "itens");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const { nome, descricao, diasPadrao, kmPadrao, horasPadrao, status } = lerCampos(formData);

  const erros = validarCampos({ nome, status, diasPadrao, kmPadrao, horasPadrao });
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  try {
    await criarItemRevisional(usuarioSessao.contaId, {
      nome,
      descricao,
      diasPadrao,
      kmPadrao,
      horasPadrao,
      status: status as StatusItemRevisional,
    });
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "nome", message: "Já existe um item revisional com esse nome." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/itens-revisionais");
  return { ok: true };
}

// Given usuário autenticado com can(editar,'itens') (inclusive Técnico de
// manutenção, que só tem essa permissão neste módulo), when edita nome/
// descrição/controles de um item existente da própria conta -> dados são
// atualizados e refletidos na listagem/filtro. Um id de ItemRevisional de
// outra conta nunca é encontrado (updateMany escopado por {id,contaId},
// AD-1) e não vaza a existência do registro (I/O Matrix).
export async function editarItemRevisionalAction(
  _estadoAnterior: EstadoAcaoItemRevisional,
  formData: FormData,
): Promise<EstadoAcaoItemRevisional> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "itens");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const itemRevisionalId = String(formData.get("itemRevisionalId") ?? "").trim();
  const { nome, descricao, diasPadrao, kmPadrao, horasPadrao, status } = lerCampos(formData);

  const erros = validarCampos({ nome, status, diasPadrao, kmPadrao, horasPadrao });
  if (!itemRevisionalId) {
    erros.push({ field: "itemRevisionalId", message: "Item revisional inválido." });
  }
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarItemRevisional(usuarioSessao.contaId, itemRevisionalId, {
      nome,
      descricao,
      diasPadrao,
      kmPadrao,
      horasPadrao,
      status: status as StatusItemRevisional,
    });
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "nome", message: "Já existe um item revisional com esse nome." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Item não encontrado nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/itens-revisionais");
  return { ok: true };
}

// Gate próprio e independente de can(...,'editar','itens') — nunca
// reaproveita o resultado de can(...,'excluir',...) (Boundaries/AD-2): o
// Técnico de manutenção só tem 'editar' neste módulo, nunca 'criar'/
// 'excluir' (perfis-de-acesso.md). "Excluir" nunca é DELETE físico (AD-10):
// só chama atualizarItemRevisional(...,{status:"Arquivado"}), a mesma
// função de repositório usada pela edição comum — sem duplicar lógica de
// update. Given usuário sem can(excluir,'itens') mas com can(editar,'itens'),
// when tenta excluir -> a ação é recusada mesmo assim (I/O Matrix).
export async function excluirItemRevisionalAction(
  _estadoAnterior: EstadoAcaoItemRevisional,
  formData: FormData,
): Promise<EstadoAcaoItemRevisional> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "excluir", "itens");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const itemRevisionalId = String(formData.get("itemRevisionalId") ?? "").trim();
  if (!itemRevisionalId) {
    return { ok: false, error: ERRO_GENERICO };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarItemRevisional(usuarioSessao.contaId, itemRevisionalId, {
      status: "Arquivado",
    });
  } catch {
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Item não encontrado nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/itens-revisionais");
  return { ok: true };
}
