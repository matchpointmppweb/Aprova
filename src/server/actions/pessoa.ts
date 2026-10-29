"use server";

import { revalidatePath } from "next/cache";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { listarCargos } from "@/src/server/repositories/cargo";
import { listarFuncoes } from "@/src/server/repositories/funcao";
import { atualizarPessoa, criarPessoa } from "@/src/server/repositories/pessoa";
import type { EstadoAcaoPessoa } from "./pessoa-estado";
import { LIMITE_DOCUMENTO, LIMITE_NOME, lerTexto, validarTamanho } from "@/src/lib/texto";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

// cpf/observacao são texto livre, sem validação de dígito verificador
// (Boundaries) — string vazia de observação vira `null`, nunca bloqueia o
// submit. cargoId/funcaoId são obrigatórios (diferente de Locais/Empresas,
// onde os campos extras eram opcionais).
function lerCampos(formData: FormData) {
  const nome = lerTexto(formData, "nome");
  const cpf = lerTexto(formData, "cpf");
  const cargoId = lerTexto(formData, "cargoId");
  const funcaoId = lerTexto(formData, "funcaoId");
  const observacaoBruta = lerTexto(formData, "observacao");
  return {
    nome,
    cpf,
    cargoId,
    funcaoId,
    observacao: observacaoBruta ? observacaoBruta : null,
  };
}

function validarCamposGerais(campos: {
  nome: string;
  cpf: string;
  cargoId: string;
  funcaoId: string;
}) {
  const erros: { field: string; message: string }[] = [];
  if (!campos.nome) erros.push({ field: "nome", message: "Informe o nome." });
  if (!campos.cpf) erros.push({ field: "cpf", message: "Informe o CPF." });
  if (!campos.cargoId) erros.push({ field: "cargoId", message: "Selecione um cargo." });
  if (!campos.funcaoId) erros.push({ field: "funcaoId", message: "Selecione uma função." });
  // Teto de tamanho (src/lib/texto.ts): recusa, nunca trunca.
  erros.push(...validarTamanho(campos.nome, LIMITE_NOME, "nome", "Nome"));
  erros.push(...validarTamanho(campos.cpf, LIMITE_DOCUMENTO, "cpf", "CPF"));
  return erros;
}

// O <select> de cargo/função no formulário já só lista opções da própria
// conta, mas a Server Action é o guard real (AD-1) — nunca confia num id
// vindo do cliente sem checar contra os dados reais da conta. Mesmo padrão
// de vinculoEResponsavelValidos em src/server/actions/plano.ts: um
// cargoId/funcaoId de outra conta submetido via request adulterado é
// rejeitado sem persistir nada (Boundaries/I-O Matrix).
async function cargoEFuncaoValidos(
  contaId: string,
  campos: { cargoId: string; funcaoId: string },
) {
  const [cargos, funcoes] = await Promise.all([listarCargos(contaId), listarFuncoes(contaId)]);

  const erros: { field: string; message: string }[] = [];
  if (campos.cargoId && !cargos.some((cargo) => cargo.id === campos.cargoId)) {
    erros.push({ field: "cargoId", message: "Selecione um cargo válido." });
  }
  if (campos.funcaoId && !funcoes.some((funcao) => funcao.id === campos.funcaoId)) {
    erros.push({ field: "funcaoId", message: "Selecione uma função válida." });
  }
  return erros;
}

// Given usuário autenticado com can(criar,'pessoas') e cargo/função
// existentes na própria conta, when cria uma pessoa com nome/cpf/cargo/
// função/observação -> Pessoa é gravada escopada pela própria conta (AD-1);
// sem coluna de status e sem ação de excluir nesta tela (Boundaries/
// AD-17/AD-18).
export async function criarPessoaAction(
  _estadoAnterior: EstadoAcaoPessoa,
  formData: FormData,
): Promise<EstadoAcaoPessoa> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, mesmo que a
  // UI já esconda/desabilite o botão "Nova pessoa".
  const autorizado = await can(usuarioSessao, "criar", "pessoas");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const campos = lerCampos(formData);

  const erros = validarCamposGerais(campos);
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  const errosDeReferencia = await cargoEFuncaoValidos(usuarioSessao.contaId, campos);
  if (errosDeReferencia.length > 0) {
    return { ok: false, error: errosDeReferencia };
  }

  try {
    await criarPessoa(usuarioSessao.contaId, {
      nome: campos.nome,
      cpf: campos.cpf,
      cargoId: campos.cargoId,
      funcaoId: campos.funcaoId,
      observacao: campos.observacao,
    });
  } catch {
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/pessoas");
  return { ok: true };
}

// Given usuário autenticado com can(editar,'pessoas'), when edita qualquer
// campo de uma pessoa existente da própria conta (nome/cpf/cargo/função/
// observação) -> dados são atualizados e refletidos na listagem (Boundaries
// — não há ação "excluir" separada nesta tela). Um id de Pessoa de outra
// conta nunca é encontrado (updateMany escopado por {id,contaId}, AD-1) e
// não vaza a existência do registro (I/O Matrix).
export async function editarPessoaAction(
  _estadoAnterior: EstadoAcaoPessoa,
  formData: FormData,
): Promise<EstadoAcaoPessoa> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "pessoas");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const pessoaId = lerTexto(formData, "pessoaId");
  const campos = lerCampos(formData);

  const erros = validarCamposGerais(campos);
  if (!pessoaId) erros.push({ field: "pessoaId", message: "Pessoa inválida." });
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  const errosDeReferencia = await cargoEFuncaoValidos(usuarioSessao.contaId, campos);
  if (errosDeReferencia.length > 0) {
    return { ok: false, error: errosDeReferencia };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarPessoa(usuarioSessao.contaId, pessoaId, {
      nome: campos.nome,
      cpf: campos.cpf,
      cargoId: campos.cargoId,
      funcaoId: campos.funcaoId,
      observacao: campos.observacao,
    });
  } catch {
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Pessoa não encontrada nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/pessoas");
  return { ok: true };
}
