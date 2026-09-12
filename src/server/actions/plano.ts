"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { listarAtivos } from "@/src/server/repositories/ativo";
import { listarItensRevisionais } from "@/src/server/repositories/item-revisional";
import {
  arquivarPlano,
  atualizarPlano,
  criarPlano,
  type DadosItemDoPlano,
} from "@/src/server/repositories/plano";
import { listarTiposAtivo } from "@/src/server/repositories/tipo-ativo";
import { listarUsuarios } from "@/src/server/repositories/usuario";
import {
  ERRO_CONFLITO_EDICAO,
  validarItensDoPlano,
  validarVinculoXor,
  type EstadoAcaoPlano,
  type ItemRevisionalReal,
  type ItemSelecionadoBruto,
} from "./plano-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
// Nunca expõe detalhe de constraint/banco (Boundaries).
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

// Nunca expõe detalhe de constraint (Boundaries) — só reconhece a violação
// da constraint única @@unique([contaId, nome]) para traduzir num erro de
// validação de campo. Mesmo padrão de src/server/actions/item-revisional.ts.
function isErroDeNomeDuplicado(erro: unknown): boolean {
  return erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002";
}

// Campo numérico opcional: string vazia -> null; string presente -> Number.
// Valores inválidos (NaN/decimal) são tratados como null pela leitura, mesmo
// padrão de src/server/actions/item-revisional.ts.
function lerCampoNumerico(formData: FormData, nome: string): number | null {
  const bruto = String(formData.get(nome) ?? "").trim();
  if (!bruto) return null;
  const valor = Number(bruto);
  return Number.isFinite(valor) && Number.isInteger(valor) ? valor : null;
}

function lerCamposGerais(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const vinculo = String(formData.get("vinculo") ?? "").trim();
  const ativoIdBruto = String(formData.get("ativoId") ?? "").trim();
  const tipoAtivoIdBruto = String(formData.get("tipoAtivoId") ?? "").trim();
  const responsavelId = String(formData.get("responsavelId") ?? "").trim();

  // Só considera o valor do vínculo cujo radio está de fato selecionado —
  // um <select> do lado "desligado" do radio pode continuar com valor
  // preenchido no DOM (Boundaries: XOR é sobre o que é de fato enviado).
  const ativoId = vinculo === "ativo" && ativoIdBruto ? ativoIdBruto : null;
  const tipoAtivoId = vinculo === "tipo" && tipoAtivoIdBruto ? tipoAtivoIdBruto : null;

  return { nome, ativoId, tipoAtivoId, responsavelId };
}

// Lê as linhas de item selecionadas no form — checkbox
// `itemSelecionado-{id}` presente para cada ItemRevisional real da conta,
// com overrides opcionais `itemDias-{id}`/`itemKm-{id}`/`itemHoras-{id}`.
function lerItensSelecionados(
  formData: FormData,
  itensDaConta: { id: string }[],
): ItemSelecionadoBruto[] {
  const itens: ItemSelecionadoBruto[] = [];
  for (const item of itensDaConta) {
    const selecionado = formData.get(`itemSelecionado-${item.id}`);
    if (!selecionado) continue;
    itens.push({
      itemRevisionalId: item.id,
      diasOverride: lerCampoNumerico(formData, `itemDias-${item.id}`),
      kmOverride: lerCampoNumerico(formData, `itemKm-${item.id}`),
      horasOverride: lerCampoNumerico(formData, `itemHoras-${item.id}`),
    });
  }
  return itens;
}

// Overrides não-nulos precisam ser positivos, mesmo critério aplicado aos
// campos padrão de ItemRevisional (validarControlesDeItemRevisional,
// item-revisional-estado.ts) — evita persistir um "override" negativo/zero
// que nunca apareceria de forma coerente na UI.
function validarOverridesPositivos(itens: ItemSelecionadoBruto[]) {
  const erros: { field: string; message: string }[] = [];
  for (const item of itens) {
    if (item.diasOverride !== null && item.diasOverride <= 0) {
      erros.push({ field: "itens", message: "Dias (sobrescrito) deve ser maior que zero." });
    }
    if (item.kmOverride !== null && item.kmOverride <= 0) {
      erros.push({ field: "itens", message: "Km (sobrescrito) deve ser maior que zero." });
    }
    if (item.horasOverride !== null && item.horasOverride <= 0) {
      erros.push({ field: "itens", message: "Horas (sobrescrito) deve ser maior que zero." });
    }
  }
  return erros;
}

function validarCamposGerais(campos: {
  nome: string;
  ativoId: string | null;
  tipoAtivoId: string | null;
  responsavelId: string;
}) {
  const erros: { field: string; message: string }[] = [];
  if (!campos.nome) {
    erros.push({ field: "nome", message: "Informe o nome do plano." });
  }
  if (!campos.responsavelId) {
    erros.push({ field: "responsavelId", message: "Selecione um responsável." });
  }
  erros.push(...validarVinculoXor(campos.ativoId, campos.tipoAtivoId));
  return erros;
}

// O <select> de ativo/tipo/responsável no formulário já só lista opções da
// própria conta, mas a Server Action é o guard real (AD-1) — nunca confia
// num id vindo do cliente sem checar contra os dados reais da conta. Mesmo
// padrão de tipoAtivoPertenceAConta em src/server/actions/ativo.ts.
async function vinculoEResponsavelValidos(
  contaId: string,
  campos: { ativoId: string | null; tipoAtivoId: string | null; responsavelId: string },
) {
  const [ativos, tipos, usuarios] = await Promise.all([
    listarAtivos(contaId),
    listarTiposAtivo(contaId),
    listarUsuarios(contaId),
  ]);

  const erros: { field: string; message: string }[] = [];
  if (campos.ativoId && !ativos.some((ativo) => ativo.id === campos.ativoId)) {
    erros.push({ field: "vinculo", message: "Selecione um ativo válido." });
  }
  if (campos.tipoAtivoId && !tipos.some((tipo) => tipo.id === campos.tipoAtivoId)) {
    erros.push({ field: "vinculo", message: "Selecione um tipo de ativo válido." });
  }
  if (campos.responsavelId && !usuarios.some((usuario) => usuario.id === campos.responsavelId)) {
    erros.push({ field: "responsavelId", message: "Selecione um responsável válido." });
  }
  return erros;
}

// Busca os ItemRevisional reais da conta (qualquer status — um item
// arquivado depois de já estar num plano continua validável, não trava a
// edição do plano) e monta o mapa usado por validarItensDoPlano contra
// invenção de controle inexistente (Boundaries).
async function buscarItensReaisPorId(contaId: string) {
  const itens = await listarItensRevisionais(contaId);
  const mapa = new Map<string, ItemRevisionalReal>();
  for (const item of itens) {
    mapa.set(item.id, {
      id: item.id,
      nome: item.nome,
      diasPadrao: item.diasPadrao,
      kmPadrao: item.kmPadrao,
      horasPadrao: item.horasPadrao,
    });
  }
  return { itens, mapa };
}

function paraDadosItens(itens: ItemSelecionadoBruto[]): DadosItemDoPlano[] {
  return itens.map((item) => ({
    itemRevisionalId: item.itemRevisionalId,
    diasOverride: item.diasOverride,
    kmOverride: item.kmOverride,
    horasOverride: item.horasOverride,
  }));
}

// Given usuário autenticado com can(criar,'planos'), when cria um plano com
// nome, vínculo (ativo OU tipo), responsável e ao menos um item selecionado
// -> plano+itens são gravados numa única transação (AD-9), escopados pela
// própria conta (AD-1), e aparecem na listagem com status/próxima revisão
// calculados por resolverAtivosDoPlano (I/O Matrix).
export async function criarPlanoAction(
  _estadoAnterior: EstadoAcaoPlano,
  formData: FormData,
): Promise<EstadoAcaoPlano> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, gate próprio
  // de 'criar' — nunca reaproveita o resultado de 'editar'/'excluir'.
  const autorizado = await can(usuarioSessao, "criar", "planos");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const camposGerais = lerCamposGerais(formData);
  const { itens: itensDaConta, mapa: itensReaisPorId } = await buscarItensReaisPorId(
    usuarioSessao.contaId,
  );
  const itensSelecionados = lerItensSelecionados(formData, itensDaConta);

  const erros = [
    ...validarCamposGerais(camposGerais),
    ...validarItensDoPlano(itensSelecionados, itensReaisPorId),
    ...validarOverridesPositivos(itensSelecionados),
  ];
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  const errosDeReferencia = await vinculoEResponsavelValidos(usuarioSessao.contaId, camposGerais);
  if (errosDeReferencia.length > 0) {
    return { ok: false, error: errosDeReferencia };
  }

  try {
    await criarPlano(usuarioSessao.contaId, {
      nome: camposGerais.nome,
      ativoId: camposGerais.ativoId,
      tipoAtivoId: camposGerais.tipoAtivoId,
      responsavelId: camposGerais.responsavelId,
      itens: paraDadosItens(itensSelecionados),
    });
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "nome", message: "Já existe um plano revisional com esse nome." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/planos-revisionais");
  return { ok: true };
}

// Given usuário autenticado com can(editar,'planos') (inclusive Técnico de
// manutenção, que só tem essa permissão neste módulo) e `updatedAt` que
// bate com o valor atual do plano, when edita nome/vínculo/responsável/itens
// -> dados são atualizados numa única transação e refletidos na listagem. Se
// `updatedAt` enviado não bater (edição concorrente no meio), nada muda e
// retorna o erro de conflito de lock otimista (AD-9, I/O Matrix) em vez de
// sobrescrever silenciosamente. Um id de plano de outra conta nunca é
// encontrado (transação escopada por {id,contaId}, AD-1).
export async function editarPlanoAction(
  _estadoAnterior: EstadoAcaoPlano,
  formData: FormData,
): Promise<EstadoAcaoPlano> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "planos");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const planoId = String(formData.get("planoId") ?? "").trim();
  const updatedAtBruto = String(formData.get("updatedAt") ?? "").trim();
  const camposGerais = lerCamposGerais(formData);
  const { itens: itensDaConta, mapa: itensReaisPorId } = await buscarItensReaisPorId(
    usuarioSessao.contaId,
  );
  const itensSelecionados = lerItensSelecionados(formData, itensDaConta);

  const erros = [
    ...validarCamposGerais(camposGerais),
    ...validarItensDoPlano(itensSelecionados, itensReaisPorId),
    ...validarOverridesPositivos(itensSelecionados),
  ];
  if (!planoId) erros.push({ field: "planoId", message: "Plano inválido." });

  const updatedAtEsperado = updatedAtBruto ? new Date(updatedAtBruto) : null;
  if (!updatedAtEsperado || Number.isNaN(updatedAtEsperado.getTime())) {
    erros.push({ field: "updatedAt", message: "Plano inválido." });
  }

  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  const errosDeReferencia = await vinculoEResponsavelValidos(usuarioSessao.contaId, camposGerais);
  if (errosDeReferencia.length > 0) {
    return { ok: false, error: errosDeReferencia };
  }

  try {
    const resultado = await atualizarPlano(
      usuarioSessao.contaId,
      planoId,
      updatedAtEsperado as Date,
      {
        nome: camposGerais.nome,
        ativoId: camposGerais.ativoId,
        tipoAtivoId: camposGerais.tipoAtivoId,
        responsavelId: camposGerais.responsavelId,
        itens: paraDadosItens(itensSelecionados),
      },
    );

    if (!resultado.ok) {
      if (resultado.motivo === "conflito") {
        return { ok: false, error: ERRO_CONFLITO_EDICAO };
      }
      // Plano não encontrado nesta conta (AD-1) — nunca expõe detalhe.
      return { ok: false, error: ERRO_GENERICO };
    }
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "nome", message: "Já existe um plano revisional com esse nome." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/planos-revisionais");
  return { ok: true };
}

// Gate próprio e independente de can(...,'editar','planos') — nunca
// reaproveita o resultado de can(...,'criar'/'editar',...) (Boundaries/
// AD-2): só Administrador tem 'excluir' neste módulo (perfis-de-acesso.md).
// "Excluir" nunca é DELETE físico (AD-10): só chama arquivarPlano(...), que
// muda o status para Arquivado sem tocar nas linhas de item — um plano
// arquivado some do cálculo de resolverAtivosDoPlano mas continua no banco
// com seus vínculos intactos (I/O Matrix).
export async function excluirPlanoAction(
  _estadoAnterior: EstadoAcaoPlano,
  formData: FormData,
): Promise<EstadoAcaoPlano> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "excluir", "planos");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const planoId = String(formData.get("planoId") ?? "").trim();
  if (!planoId) {
    return { ok: false, error: ERRO_GENERICO };
  }

  let arquivou: boolean;
  try {
    arquivou = await arquivarPlano(usuarioSessao.contaId, planoId);
  } catch {
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!arquivou) {
    // Plano não encontrado nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/planos-revisionais");
  return { ok: true };
}
