"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type PlanoContratado, type StatusConta } from "@prisma/client";

import { auth } from "@/src/server/auth";
import { exigirOperadorDePlataforma } from "@/src/server/auth/sessao";
import { atualizarConta, criarConta } from "@/src/server/repositories/conta";
import { ProvisionamentoInconsistenteError } from "@/src/server/repositories/provisionamento";
import type {
  EstadoAcaoConta,
  EstadoAcaoCriacaoConta,
  ValoresNovaConta,
} from "./conta-estado";

const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";
const PLANOS_VALIDOS: PlanoContratado[] = ["Essencial", "Corporativo"];
const STATUS_VALIDOS: StatusConta[] = ["Ativa", "PagamentoPendente"];
// Mesma recusa NEUTRA do convite dentro de uma conta (actions/usuario.ts): não
// afirma nem nega a existência do e-mail na plataforma. Aqui ela só aparece na
// corrida rara de duas identidades com o mesmo e-mail criadas no mesmo
// instante — o caminho normal do e-mail já existente é SUCESSO, e cria só o
// vínculo novo (regra da Story 6.6).
const ERRO_EMAIL_INDISPONIVEL = "Não foi possível usar este e-mail.";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Nunca expõe detalhe de banco/constraint (Boundaries) — só reconhece a
// violação de uma constraint única para traduzir num erro de validação de
// campo. O `meta.target` é checado, e não só o código: desde a Story 6.7 a
// criação de conta grava também identidade e vínculo na mesma transação, então
// um P2002 de `usuarios.email` chegaria aqui e viraria, erradamente, "CNPJ já
// em uso". O target vem ora como lista de campos, ora como nome do índice.
function alvoDoP2002(erro: unknown): string[] | null {
  if (
    !(erro instanceof Prisma.PrismaClientKnownRequestError) ||
    erro.code !== "P2002"
  ) {
    return null;
  }
  const alvo = erro.meta?.target;
  if (Array.isArray(alvo)) return alvo.map(String);
  return typeof alvo === "string" ? [alvo] : [];
}

function isErroDeEmailDuplicado(erro: unknown): boolean {
  const alvo = alvoDoP2002(erro);
  return alvo !== null && alvo.some((campo) => campo.includes("email"));
}

// CNPJ é o ÚNICO unique da escrita de `Conta`, então qualquer P2002 que não
// seja de e-mail é tratado como CNPJ duplicado — inclusive quando o
// `meta.target` vem ausente ou com um nome que não reconhecemos, o que alguns
// drivers/versões fazem. Exigir o campo no target faria um CNPJ duplicado
// legítimo regredir para o erro genérico "tente novamente", sem apontar o
// campo. O alvo desconhecido vai para o log de servidor: se um dia for outra
// coisa, é lá que aparece — a mensagem ao operador nunca expõe detalhe de
// constraint (Boundaries).
function isErroDeCnpjDuplicado(erro: unknown): boolean {
  const alvo = alvoDoP2002(erro);
  if (alvo === null || isErroDeEmailDuplicado(erro)) return false;
  if (!alvo.some((campo) => campo.includes("cnpj"))) {
    console.error(
      "[conta] P2002 com alvo inesperado, tratado como CNPJ duplicado:",
      erro,
    );
  }
  return true;
}

function lerCampos(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  // Só dígitos antes de gravar/comparar contra @@unique([cnpj]) — sem isso,
  // "12.345.678/0001-90" e "12345678000190" (mesmo CNPJ, pontuação
  // diferente) passariam pela constraint como valores distintos.
  const cnpj = String(formData.get("cnpj") ?? "").replace(/\D/g, "");
  const planoContratado = String(
    formData.get("planoContratado") ?? "",
  ).trim() as PlanoContratado;
  const status = String(formData.get("status") ?? "").trim() as StatusConta;

  const erros: { field: string; message: string }[] = [];
  if (!nome) erros.push({ field: "nome", message: "Informe o nome da conta." });
  if (!cnpj) erros.push({ field: "cnpj", message: "Informe o CNPJ." });
  if (!PLANOS_VALIDOS.includes(planoContratado)) {
    erros.push({ field: "planoContratado", message: "Selecione um plano válido." });
  }
  if (!STATUS_VALIDOS.includes(status)) {
    erros.push({ field: "status", message: "Selecione um status válido." });
  }

  return { nome, cnpj, planoContratado, status, erros };
}

// Nome e e-mail do primeiro Administrador (Story 6.7) — lidos SÓ na criação:
// editar uma conta não mexe em quem administra ela.
function lerAdministrador(formData: FormData) {
  const nome = String(formData.get("adminNome") ?? "").trim();
  const email = String(formData.get("adminEmail") ?? "")
    .trim()
    .toLowerCase();

  const erros: { field: string; message: string }[] = [];
  if (!nome) {
    erros.push({ field: "adminNome", message: "Informe o nome do administrador." });
  }
  if (!email) {
    erros.push({ field: "adminEmail", message: "Informe o e-mail do administrador." });
  } else if (!EMAIL_REGEX.test(email)) {
    erros.push({ field: "adminEmail", message: "Informe um e-mail válido." });
  }

  return { nome, email, erros };
}

// Given operador de plataforma autenticado (isPlataformaOperador === true,
// checado exclusivamente por exigirOperadorDePlataforma() — nunca can(),
// AD-13), when cria uma conta com nome/CNPJ/plano/status e o nome e e-mail do
// primeiro Administrador -> a conta, seus perfis de acesso padrão e o vínculo
// do Administrador nascem na MESMA transação (Story 6.7, AD-9), e o convite de
// definição de senha sai depois do commit.
//
// A validação inteira roda ANTES de qualquer escrita: campo faltando ou e-mail
// malformado não grava nada. CNPJ duplicado aborta a transação — nem conta, nem
// perfis, nem vínculo.
export async function criarContaAction(
  _estadoAnterior: EstadoAcaoCriacaoConta,
  formData: FormData,
): Promise<EstadoAcaoCriacaoConta> {
  await exigirOperadorDePlataforma();

  const { nome, cnpj, planoContratado, status, erros } = lerCampos(formData);
  const administrador = lerAdministrador(formData);
  erros.push(...administrador.erros);

  // Devolvido em todo caminho de erro para o formulário repor o que foi
  // digitado — seis campos é redigitação demais para um CNPJ repetido.
  const valores: ValoresNovaConta = {
    nome,
    cnpj: String(formData.get("cnpj") ?? "").trim(),
    planoContratado,
    status,
    adminNome: administrador.nome,
    adminEmail: administrador.email,
  };

  if (erros.length > 0) {
    return { ok: false, error: erros, data: { valores } };
  }

  let enviarDefinicaoDeSenha: boolean;
  try {
    ({ enviarDefinicaoDeSenha } = await criarConta({
      conta: { nome, cnpj, planoContratado, status },
      administrador: { nome: administrador.nome, email: administrador.email },
    }));
  } catch (erro) {
    if (isErroDeCnpjDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "cnpj", message: "Este CNPJ já está em uso na plataforma." }],
        data: { valores },
      };
    }
    if (isErroDeEmailDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "adminEmail", message: ERRO_EMAIL_INDISPONIVEL }],
        data: { valores },
      };
    }
    // Estado documentado como impossível (conta recém-criada já com vínculo, ou
    // matriz de perfis sem o Administrador): nada foi gravado, mas o operador só
    // vê o erro genérico. Sem este log não sobra rastro nenhum de um defeito
    // estrutural.
    if (erro instanceof ProvisionamentoInconsistenteError) {
      console.error("[conta] Provisionamento inconsistente:", erro.message);
    } else {
      console.error("[conta] Falha ao provisionar conta:", erro);
    }
    return { ok: false, error: ERRO_GENERICO, data: { valores } };
  }

  // Fora da transação e depois do commit, exatamente como no convite dentro de
  // uma conta (convidarUsuarioAction): mesmo endpoint de "esqueci minha senha",
  // que gera o link e aciona sendResetPassword. Uma falha aqui NÃO desfaz o
  // provisionamento — a conta permanece utilizável e o convite pode ser refeito
  // pelo fluxo normal (I/O Matrix). Só sai quando a identidade não tem
  // credencial, critério decidido dentro da transação (Story 6.6).
  let aviso: string | undefined;
  if (enviarDefinicaoDeSenha) {
    await auth.api
      .requestPasswordReset({
        body: { email: administrador.email, redirectTo: "/redefinir-senha" },
      })
      .catch((erro: unknown) => {
        // Nem erro (a conta está provisionada e utilizável) nem silêncio: sem
        // log, um administrador cujo convite nunca saiu fica indistinguível de
        // um provisionamento perfeito.
        console.error(
          "[conta] Conta provisionada, mas o convite de definição de senha falhou:",
          erro,
        );
      });
  } else {
    // O e-mail já tinha credencial na plataforma (regra da Story 6.6: a senha
    // dela continua valendo e nenhum token é emitido). O operador precisa saber
    // disso para avisar a pessoa — senão ele espera um e-mail que nunca vai
    // chegar. Não abre enumeração: o destinatário é o operador de plataforma,
    // que por AD-13 já enxerga todas as contas e todos os vínculos.
    aviso =
      "Conta criada. O administrador informado já tinha acesso à plataforma: ele foi vinculado à nova conta e NÃO recebeu e-mail de definição de senha — avise-o para entrar com a senha que já usa.";
  }

  revalidatePath("/contas");
  return { ok: true, data: { aviso } };
}

// Given operador de plataforma autenticado, when edita nome/CNPJ/plano/
// status de uma conta existente -> dados refletidos na listagem. Editar
// status para "Pagamento pendente" bloqueia login dos usuários dessa conta
// via entrarAction/exigirUsuarioAutenticado (comportamento já existente,
// nenhum código novo necessário aqui — I/O Matrix da story).
export async function editarContaAction(
  _estadoAnterior: EstadoAcaoConta,
  formData: FormData,
): Promise<EstadoAcaoConta> {
  await exigirOperadorDePlataforma();

  const contaId = String(formData.get("contaId") ?? "").trim();
  const { nome, cnpj, planoContratado, status, erros } = lerCampos(formData);
  if (!contaId) erros.push({ field: "contaId", message: "Conta inválida." });
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  let atualizou: boolean;
  try {
    atualizou = await atualizarConta(contaId, { nome, cnpj, planoContratado, status });
  } catch (erro) {
    if (isErroDeCnpjDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "cnpj", message: "Este CNPJ já está em uso na plataforma." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  if (!atualizou) {
    // Conta não encontrada — nunca expõe detalhe (Boundaries).
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/contas");
  return { ok: true };
}
