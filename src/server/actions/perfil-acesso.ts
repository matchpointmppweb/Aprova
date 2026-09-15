"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type Modulo } from "@prisma/client";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { MODULOS_PERFIL, NOME_ADMINISTRADOR } from "@/src/lib/modulos";
import {
  atualizarPerfilAcesso,
  buscarPerfilAcesso,
  criarPerfilAcesso,
  type PermissaoParaGravar,
} from "@/src/server/repositories/perfil-acesso";
import type { EstadoAcaoPerfil } from "./perfil-acesso-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

// Nunca expõe detalhe de constraint (Boundaries) — só reconhece a violação
// da constraint única @@unique([contaId, nome]) para traduzir num erro de
// validação de campo.
function isErroDeNomeDuplicado(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002"
  );
}

// Lê, para cada módulo configurável (MODULOS_PERFIL, AD-13 —
// "contas" nunca aparece aqui), os 3 checkboxes de criar/editar/excluir do
// formulário do modal. Um checkbox desmarcado simplesmente não aparece no
// FormData — daí o `=== "on"` em vez de checar truthiness de string.
function lerPermissoes(formData: FormData): PermissaoParaGravar[] {
  return MODULOS_PERFIL.map(({ key }) => ({
    modulo: key as Modulo,
    criar: formData.get(`perm-${key}-criar`) === "on",
    editar: formData.get(`perm-${key}-editar`) === "on",
    excluir: formData.get(`perm-${key}-excluir`) === "on",
  }));
}

function lerCamposGerais(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const descricaoBruta = String(formData.get("descricao") ?? "").trim();
  return { nome, descricao: descricaoBruta ? descricaoBruta : null };
}

// Given Administrador autenticado, when cria um perfil com nome, descrição
// e uma combinação de permissões por módulo -> PerfilAcesso + suas 8 linhas
// de PermissaoModulo são gravados numa única escrita (AD-9), e o perfil
// aparece na listagem e no dropdown de convite/edição de usuário (Story
// 1.2, que já lê listarPerfisAcesso sem nenhuma mudança).
export async function criarPerfilAcessoAction(
  _estadoAnterior: EstadoAcaoPerfil,
  formData: FormData,
): Promise<EstadoAcaoPerfil> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, mesmo que a
  // UI já esconda/desabilite o botão "Novo perfil".
  const autorizado = await can(usuarioSessao, "criar", "perfil");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const { nome, descricao } = lerCamposGerais(formData);
  if (!nome) {
    return { ok: false, error: [{ field: "nome", message: "Informe o nome do perfil." }] };
  }

  const permissoes = lerPermissoes(formData);

  try {
    await criarPerfilAcesso(usuarioSessao.contaId, { nome, descricao, permissoes });
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "nome", message: "Já existe um perfil com este nome nesta conta." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/perfil-acesso");
  return { ok: true };
}

// Given Administrador autenticado, when edita nome/descrição/permissões de
// um perfil existente (incluindo os 4 perfis do seed) -> perfil + suas 8
// linhas de permissão são atualizados numa única transação (AD-9), e
// usuários com esse perfil respeitam as novas permissões na próxima chamada
// de can() (sem cache de permissão em nenhuma camada). Recusa renomear o
// perfil "Administrador" (Boundaries/AC desta story).
export async function editarPerfilAcessoAction(
  _estadoAnterior: EstadoAcaoPerfil,
  formData: FormData,
): Promise<EstadoAcaoPerfil> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "perfil");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const perfilAcessoId = String(formData.get("perfilAcessoId") ?? "").trim();
  const { nome, descricao } = lerCamposGerais(formData);

  const erros: { field: string; message: string }[] = [];
  if (!perfilAcessoId) erros.push({ field: "perfilAcessoId", message: "Perfil inválido." });
  if (!nome) erros.push({ field: "nome", message: "Informe o nome do perfil." });
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  // Escopado pela própria conta (AD-1) — um id de outra conta nunca é
  // encontrado. Também é a leitura que sustenta a guarda de nome protegido
  // abaixo: precisa do nome *atual* do perfil, não do que veio no form.
  const perfilAtual = await buscarPerfilAcesso(usuarioSessao.contaId, perfilAcessoId);
  if (!perfilAtual) {
    return { ok: false, error: ERRO_GENERICO };
  }

  if (perfilAtual.nome === NOME_ADMINISTRADOR && nome !== NOME_ADMINISTRADOR) {
    return {
      ok: false,
      error: [
        {
          field: "nome",
          message: 'O nome do perfil "Administrador" não pode ser alterado.',
        },
      ],
    };
  }

  const permissoes = lerPermissoes(formData);

  // Mesma guarda de "último Administrador ativo": não basta proteger o
  // *nome* do perfil Administrador, senão desmarcar "editar" no módulo
  // "perfil" para ele mesmo tranca todo admin fora da gestão de
  // perfis/usuários sem nenhum caminho de recuperação pela UI.
  if (perfilAtual.nome === NOME_ADMINISTRADOR) {
    const permissaoPerfil = permissoes.find((permissao) => permissao.modulo === "perfil");
    if (!permissaoPerfil?.editar) {
      return {
        ok: false,
        error: [
          {
            field: "nome",
            message:
              'O perfil "Administrador" precisa manter a permissão de editar o módulo "Perfil de acesso".',
          },
        ],
      };
    }
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarPerfilAcesso(usuarioSessao.contaId, perfilAcessoId, {
      nome,
      descricao,
      permissoes,
    });
  } catch (erro) {
    if (isErroDeNomeDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "nome", message: "Já existe um perfil com este nome nesta conta." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Perfil não encontrado nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/perfil-acesso");
  // Nomes de perfil também aparecem no dropdown de convite/edição de
  // usuário (Story 1.2).
  revalidatePath("/usuarios");
  return { ok: true };
}
