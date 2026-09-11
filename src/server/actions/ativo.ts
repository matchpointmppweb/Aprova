"use server";

import { revalidatePath } from "next/cache";
import type { StatusAtivo } from "@prisma/client";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { atualizarAtivo, criarAtivo } from "@/src/server/repositories/ativo";
import { listarTiposAtivo } from "@/src/server/repositories/tipo-ativo";
import type { EstadoAcaoAtivo } from "./ativo-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
// Nunca expõe detalhe de constraint/banco (Boundaries) — inclusive uma
// eventual colisão de código sob concorrência (@@unique([contaId, codigo]),
// que a transação Serializable já deveria ter evitado) cai neste mesmo erro
// genérico, pedindo para o usuário tentar de novo.
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

const STATUS_VALIDOS: StatusAtivo[] = ["Ativo", "Inativo", "Bloqueado", "Vendido"];

function lerCampos(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const tipoAtivoId = String(formData.get("tipoAtivoId") ?? "").trim();
  const localizacao = String(formData.get("localizacao") ?? "").trim();
  const numeroSerieBruto = String(formData.get("numeroSerie") ?? "").trim();
  const statusBruto = String(formData.get("status") ?? "").trim();
  return {
    nome,
    tipoAtivoId,
    localizacao,
    numeroSerie: numeroSerieBruto ? numeroSerieBruto : null,
    status: statusBruto,
  };
}

function validarCampos(campos: {
  nome: string;
  tipoAtivoId: string;
  localizacao: string;
  status: string;
}) {
  const erros: { field: string; message: string }[] = [];
  if (!campos.nome) erros.push({ field: "nome", message: "Informe o nome do ativo." });
  if (!campos.tipoAtivoId) {
    erros.push({ field: "tipoAtivoId", message: "Selecione um tipo." });
  }
  if (!campos.localizacao) {
    erros.push({ field: "localizacao", message: "Informe a localização." });
  }
  if (!STATUS_VALIDOS.includes(campos.status as StatusAtivo)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }
  return erros;
}

// O select de Tipo no formulário já só lista tipos da própria conta, mas a
// Server Action é o guard real (AD-1) — nunca confia num id vindo do
// cliente sem checar contra listarTiposAtivo(contaId).
async function tipoAtivoPertenceAConta(contaId: string, tipoAtivoId: string) {
  const tipos = await listarTiposAtivo(contaId);
  return tipos.some((tipo) => tipo.id === tipoAtivoId);
}

// Given usuário autenticado com can(criar,'ativos') e ao menos um Tipo já
// cadastrado na conta, when cria um ativo com nome/tipo/localização/status
// -> Ativo é gravado escopado pela própria conta (AD-1) com código
// sequencial gerado ("AT-000N") e aparece na listagem; a contagem "Ativos
// vinculados" do Tipo escolhido (tela de Tipos) reflete o novo total.
export async function criarAtivoAction(
  _estadoAnterior: EstadoAcaoAtivo,
  formData: FormData,
): Promise<EstadoAcaoAtivo> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, mesmo que a
  // UI já esconda/desabilite o botão "Novo ativo".
  const autorizado = await can(usuarioSessao, "criar", "ativos");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const { nome, tipoAtivoId, localizacao, numeroSerie, status } = lerCampos(formData);

  const erros = validarCampos({ nome, tipoAtivoId, localizacao, status });
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  if (!(await tipoAtivoPertenceAConta(usuarioSessao.contaId, tipoAtivoId))) {
    return {
      ok: false,
      error: [{ field: "tipoAtivoId", message: "Selecione um tipo válido." }],
    };
  }

  try {
    await criarAtivo(usuarioSessao.contaId, {
      nome,
      tipoAtivoId,
      localizacao,
      numeroSerie,
      status: status as StatusAtivo,
    });
  } catch {
    return { ok: false, error: ERRO_GENERICO };
  }

  // A contagem "Ativos vinculados" da tela de Tipos depende deste mesmo
  // Ativo recém-criado, então /tipos também precisa revalidar.
  revalidatePath("/ativos");
  revalidatePath("/tipos");
  return { ok: true };
}

// Given usuário autenticado com can(editar,'ativos'), when edita nome/tipo/
// localização/número de série/status de um ativo existente da própria conta
// -> dados são atualizados e refletidos na listagem/filtro; se o Tipo mudou,
// as contagens de ambos os Tipos (antigo e novo) se ajustam na tela de
// Tipos. Um id de Ativo de outra conta nunca é encontrado (updateMany
// escopado por {id,contaId}, AD-1) e não vaza a existência do registro (I/O
// Matrix).
export async function editarAtivoAction(
  _estadoAnterior: EstadoAcaoAtivo,
  formData: FormData,
): Promise<EstadoAcaoAtivo> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "ativos");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const ativoId = String(formData.get("ativoId") ?? "").trim();
  const { nome, tipoAtivoId, localizacao, numeroSerie, status } = lerCampos(formData);

  const erros = validarCampos({ nome, tipoAtivoId, localizacao, status });
  if (!ativoId) erros.push({ field: "ativoId", message: "Ativo inválido." });
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  if (!(await tipoAtivoPertenceAConta(usuarioSessao.contaId, tipoAtivoId))) {
    return {
      ok: false,
      error: [{ field: "tipoAtivoId", message: "Selecione um tipo válido." }],
    };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarAtivo(usuarioSessao.contaId, ativoId, {
      nome,
      tipoAtivoId,
      localizacao,
      numeroSerie,
      status: status as StatusAtivo,
    });
  } catch {
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Ativo não encontrado nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/ativos");
  revalidatePath("/tipos");
  return { ok: true };
}

// Gate próprio e independente de can(...,'excluir','ativos') — nunca
// reaproveita o resultado de can(...,'editar',...) (Boundaries/AD-2):
// primeiro módulo do produto em que um usuário real (Técnico de manutenção)
// edita mas não exclui. "Excluir" nunca é DELETE físico (AD-10): só chama
// atualizarAtivo(...,{status:"Inativo"}), a mesma função de repositório
// usada pela edição comum — sem duplicar lógica de update. Given usuário sem
// can(excluir,'ativos') mas com can(editar,'ativos'), when tenta excluir ->
// a ação é recusada mesmo assim (I/O Matrix), e o mesmo usuário continua
// livre para mudar o campo Status pelo form de edição comum.
export async function excluirAtivoAction(
  _estadoAnterior: EstadoAcaoAtivo,
  formData: FormData,
): Promise<EstadoAcaoAtivo> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "excluir", "ativos");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const ativoId = String(formData.get("ativoId") ?? "").trim();
  if (!ativoId) {
    return { ok: false, error: ERRO_GENERICO };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarAtivo(usuarioSessao.contaId, ativoId, {
      status: "Inativo",
    });
  } catch {
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Ativo não encontrado nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/ativos");
  revalidatePath("/tipos");
  return { ok: true };
}
