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
  type ResultadoConvite,
} from "@/src/server/repositories/usuario";
import type { EstadoAcaoUsuario } from "./usuario-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";
const STATUS_VALIDOS: StatusUsuario[] = ["Ativo", "ConvitePendente", "Inativo"];
// Recusa NEUTRA, que não afirma nem nega a existência do e-mail. Com o unique
// global da Story 6.3, "já está em uso" viraria um oráculo: qualquer
// administrador poderia sondar, um e-mail por vez, quem existe em QUALQUER
// conta da plataforma — inclusive dentro de outro cliente. É a mesma disciplina
// anti-enumeração que entrarAction e solicitarResetSenhaAction mantêm de
// propósito.
const ERRO_EMAIL_INDISPONIVEL = "Não foi possível usar este e-mail.";
// Story 6.6: o ÚNICO caso em que o convite ainda recusa um e-mail. Diferente do
// anterior, esta mensagem pode ser específica sem abrir enumeração — ela só
// afirma algo que o administrador já vê na própria listagem desta conta, e nada
// sobre a existência da pessoa na plataforma.
const ERRO_JA_TEM_ACESSO = "Esta pessoa já tem acesso a esta conta.";
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
// violação da constraint única (GLOBAL desde a Story 6.3) de `Usuario.email`
// para traduzir num erro de validação de campo.
//
// A Story 6.6 tirou daqui o caminho NORMAL do e-mail já existente: convidar
// alguém que já tem identidade agora cria só um vínculo e é SUCESSO, decidido
// dentro da transação de `criarUsuarioConvidado`. O que ainda pode chegar aqui
// pelo convite é a corrida rara (duas identidades com o mesmo e-mail criadas no
// mesmo instante) e, pela edição, uma troca de e-mail para um já usado — os dois
// merecem a recusa neutra.
//
// O `meta.target` é checado, e não só o código: o convite escreve identidade e
// vínculo na mesma transação, então um P2002 de @@unique([usuarioId, contaId])
// também chegaria aqui e viraria, erradamente, um erro no campo "email" (o
// repositório já o traduz, mas a guarda fica). O target vem ora como lista de
// campos (["email"]), ora como nome do índice ("usuarios_email_key") — os dois
// casam.
function isErroDeEmailDuplicado(erro: unknown): boolean {
  if (
    !(erro instanceof Prisma.PrismaClientKnownRequestError) ||
    erro.code !== "P2002"
  ) {
    return false;
  }
  const alvo = erro.meta?.target;
  const campos = Array.isArray(alvo)
    ? alvo.map(String)
    : typeof alvo === "string"
      ? [alvo]
      : [];
  return campos.some((campo) => campo === "email" || campo.includes("email"));
}

// Given Administrador autenticado, when convida alguém com nome, e-mail e um
// perfil existente -> a pessoa passa a ter ACESSO A ESTA CONTA.
//
// Story 6.6: o convite opera sobre VÍNCULOS. Sem identidade na plataforma,
// identidade e vínculo nascem juntos e o link de definição de senha é enviado
// (logado no console em modo dev, reaproveitando o fluxo de reset do Better
// Auth). COM identidade, cria-se apenas o vínculo — senha e demais vínculos
// intactos, identidade jamais renomeada, nenhum e-mail disparado. A resposta é
// indistinguível nos dois casos (NFR2); o único desfecho diferente é a pessoa
// já ter acesso a esta conta, que devolve erro no campo e-mail.
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

  let convite: ResultadoConvite;
  try {
    convite = await criarUsuarioConvidado(usuarioSessao.contaId, {
      nome,
      email,
      perfilAcessoId,
    });
  } catch (erro) {
    if (isErroDeEmailDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "email", message: ERRO_EMAIL_INDISPONIVEL }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  // Único erro de campo que o convite ainda produz (Story 6.6): a pessoa já tem
  // vínculo Ativo/ConvitePendente com ESTA conta. Nada foi escrito — nenhum
  // vínculo duplicado existe.
  if (convite.resultado === "ja-tem-acesso") {
    return { ok: false, error: [{ field: "email", message: ERRO_JA_TEM_ACESSO }] };
  }

  // Mesmo endpoint usado por "esqueci minha senha" — gera o token/link e
  // aciona sendResetPassword (server/auth/index.ts), que loga via
  // logarLinkDeDefinicaoDeSenha (modo dev). Uma falha aqui não desfaz o
  // convite já criado (o usuário aparece na listagem mesmo assim); nunca
  // expõe detalhe interno.
  //
  // SÓ quando a identidade não tem credencial (Story 6.6) — critério decidido
  // dentro da transação, em `criarUsuarioConvidado`. Cobre tanto a identidade
  // recém-criada quanto a de alguém convidado antes que nunca aceitou: sem isso,
  // convidá-lo para uma segunda conta o deixaria sem como definir senha e sem
  // como entrar em lugar nenhum. Quem já tem senha não recebe nada — ela continua
  // valendo, e emitir um token de redefinição sobre a credencial dela não é
  // assunto desta conta. A resposta devolvida abaixo é a MESMA nos dois
  // caminhos — a ausência do e-mail não é observável por quem convidou (NFR2).
  if (convite.enviarDefinicaoDeSenha) {
    await auth.api
      .requestPasswordReset({ body: { email, redirectTo: "/redefinir-senha" } })
      .catch(() => {});
  }

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
          // `statusDoVinculo`, e não `status`: desde a Story 6.3 o `status` do
          // objeto de sessão é o GLOBAL da identidade, enquanto o `<select>`
          // deste formulário e contarAdministradoresAtivos falam do status
          // NAQUELA conta — que é o que esta comparação sempre quis dizer.
          const eraAdministradorAtivo =
            usuarioSessao.perfilAcesso.nome === "Administrador" &&
            usuarioSessao.statusDoVinculo === "Ativo";
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
        error: [{ field: "email", message: ERRO_EMAIL_INDISPONIVEL }],
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
