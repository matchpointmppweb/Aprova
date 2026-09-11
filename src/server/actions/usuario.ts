"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type StatusUsuario } from "@prisma/client";

import { prisma } from "@/src/server/repositories/db";
import { auth } from "@/src/server/auth";
import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { listarPerfisAcesso } from "@/src/server/repositories/perfil-acesso";
import {
  atualizarUsuario,
  contarAdministradoresAtivos,
  criarUsuarioConvidado,
} from "@/src/server/repositories/usuario";
import type { EstadoAcaoUsuario } from "./usuario-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";
const STATUS_VALIDOS: StatusUsuario[] = ["Ativo", "ConvitePendente", "Inativo"];
// Validação básica de formato, suficiente para recusar e-mails claramente
// malformados antes de persistir ou repassar para
// auth.api.requestPasswordReset (cujo zod interno rejeitaria de qualquer
// forma, mas de um jeito que hoje é engolido silenciosamente).
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizarEmail(valor: FormDataEntryValue | null) {
  return String(valor ?? "").trim().toLowerCase();
}

// Sinaliza, de dentro da transação da guarda de "último Administrador", que
// a atualização deve ser recusada — distinto de um erro genérico de banco.
class UltimoAdministradorAtivoError extends Error {}

// Nunca expõe detalhe de banco/constraint (Boundaries) — só reconhece a
// violação da constraint única @@unique([contaId, email]) para traduzir num
// erro de validação de campo.
function isErroDeEmailDuplicado(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002"
  );
}

// Given Administrador autenticado, when convida um usuário com nome, e-mail
// e um perfil existente -> Usuario criado com status ConvitePendente; o link
// de definição de senha é logado no console (modo dev), reaproveitando o
// fluxo de reset de senha já existente do Better Auth (Intent/Approach desta
// story — sem Account/senha no momento do convite).
export async function convidarUsuarioAction(
  _estadoAnterior: EstadoAcaoUsuario,
  formData: FormData,
): Promise<EstadoAcaoUsuario> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, mesmo que a
  // UI já esconda/desabilite o botão de convidar.
  const autorizado = await can(usuarioSessao, "criar", "usuarios");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const nome = String(formData.get("nome") ?? "").trim();
  const email = normalizarEmail(formData.get("email"));
  const perfilAcessoId = String(formData.get("perfilAcessoId") ?? "").trim();

  const erros: { field: string; message: string }[] = [];
  if (!nome) erros.push({ field: "nome", message: "Informe o nome." });
  if (!email) erros.push({ field: "email", message: "Informe o e-mail." });
  else if (!EMAIL_REGEX.test(email)) {
    erros.push({ field: "email", message: "Informe um e-mail válido." });
  }
  if (!perfilAcessoId) {
    erros.push({ field: "perfilAcessoId", message: "Selecione um perfil de acesso." });
  }
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  // O dropdown já só lista perfis da própria conta, mas a Server Action é o
  // guard real (AD-1) — nunca confia num id vindo do cliente sem checar.
  const perfis = await listarPerfisAcesso(usuarioSessao.contaId);
  if (!perfis.some((perfil) => perfil.id === perfilAcessoId)) {
    return {
      ok: false,
      error: [{ field: "perfilAcessoId", message: "Selecione um perfil de acesso válido." }],
    };
  }

  try {
    await criarUsuarioConvidado(usuarioSessao.contaId, { nome, email, perfilAcessoId });
  } catch (erro) {
    if (isErroDeEmailDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "email", message: "Este e-mail já está em uso nesta conta." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  // Mesmo endpoint usado por "esqueci minha senha" — gera o token/link e
  // aciona sendResetPassword (server/auth/index.ts), que loga via
  // logarLinkDeDefinicaoDeSenha (modo dev). Uma falha aqui não desfaz o
  // convite já criado (o usuário aparece na listagem mesmo assim); nunca
  // expõe detalhe interno.
  await auth.api
    .requestPasswordReset({ body: { email, redirectTo: "/redefinir-senha" } })
    .catch(() => {});

  revalidatePath("/usuarios");
  return { ok: true };
}

// Given Administrador autenticado, when edita nome/e-mail/perfil/status de
// um usuário existente -> dados atualizados e refletidos na listagem.
// Recusa autoedição de perfil/status quando o alvo é o próprio usuário
// logado e ele é o único Administrador ativo da conta (Decisão confirmada
// pelo usuário, ver Intent).
export async function editarUsuarioAction(
  _estadoAnterior: EstadoAcaoUsuario,
  formData: FormData,
): Promise<EstadoAcaoUsuario> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "usuarios");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const usuarioId = String(formData.get("usuarioId") ?? "").trim();
  const nome = String(formData.get("nome") ?? "").trim();
  const email = normalizarEmail(formData.get("email"));
  const perfilAcessoId = String(formData.get("perfilAcessoId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as StatusUsuario;

  const erros: { field: string; message: string }[] = [];
  if (!usuarioId) erros.push({ field: "usuarioId", message: "Usuário inválido." });
  if (!nome) erros.push({ field: "nome", message: "Informe o nome." });
  if (!email) erros.push({ field: "email", message: "Informe o e-mail." });
  else if (!EMAIL_REGEX.test(email)) {
    erros.push({ field: "email", message: "Informe um e-mail válido." });
  }
  if (!perfilAcessoId) {
    erros.push({ field: "perfilAcessoId", message: "Selecione um perfil de acesso." });
  }
  if (!STATUS_VALIDOS.includes(status)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  const perfis = await listarPerfisAcesso(usuarioSessao.contaId);
  const perfilSelecionado = perfis.find((perfil) => perfil.id === perfilAcessoId);
  if (!perfilSelecionado) {
    return {
      ok: false,
      error: [{ field: "perfilAcessoId", message: "Selecione um perfil de acesso válido." }],
    };
  }

  // Guarda de último Administrador — só se aplica à autoedição (alvo é o
  // próprio usuário logado). Editar outro usuário nunca passa por aqui.
  //
  // A contagem e o update rodam dentro da mesma transação (isolamento
  // Serializable) para que duas autoedições concorrentes de Administradores
  // diferentes não possam ambas ler a mesma contagem pré-update, ambas
  // passar na guarda e juntas zerar os Administradores ativos da conta.
  let atualizou: boolean;
  try {
    atualizou = await prisma.$transaction(
      async (tx) => {
        if (usuarioId === usuarioSessao.id) {
          const eraAdministradorAtivo =
            usuarioSessao.perfilAcesso.nome === "Administrador" &&
            usuarioSessao.status === "Ativo";
          const continuaAdministradorAtivo =
            perfilSelecionado.nome === "Administrador" && status === "Ativo";

          if (eraAdministradorAtivo && !continuaAdministradorAtivo) {
            const administradoresAtivos = await contarAdministradoresAtivos(
              usuarioSessao.contaId,
              tx,
            );
            if (administradoresAtivos <= 1) {
              throw new UltimoAdministradorAtivoError();
            }
          }
        }

        return atualizarUsuario(
          usuarioSessao.contaId,
          usuarioId,
          { nome, email, perfilAcessoId, status },
          tx,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (erro) {
    if (erro instanceof UltimoAdministradorAtivoError) {
      return {
        ok: false,
        error:
          "Você é o único Administrador ativo da conta — não é possível alterar seu próprio perfil ou status. Promova outro Administrador antes de tentar de novo.",
      };
    }
    if (isErroDeEmailDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "email", message: "Este e-mail já está em uso nesta conta." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Usuário não encontrado nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/usuarios");
  return { ok: true };
}
