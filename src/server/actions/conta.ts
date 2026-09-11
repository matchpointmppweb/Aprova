"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type PlanoContratado, type StatusConta } from "@prisma/client";

import { exigirOperadorDePlataforma } from "@/src/server/auth/sessao";
import { atualizarConta, criarConta } from "@/src/server/repositories/conta";
import type { EstadoAcaoConta } from "./conta-estado";

const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";
const PLANOS_VALIDOS: PlanoContratado[] = ["Essencial", "Corporativo"];
const STATUS_VALIDOS: StatusConta[] = ["Ativa", "PagamentoPendente"];

// Nunca expõe detalhe de banco/constraint (Boundaries) — só reconhece a
// violação da constraint única @@unique([cnpj]) para traduzir num erro de
// validação de campo.
function isErroDeCnpjDuplicado(erro: unknown): boolean {
  return (
    erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002"
  );
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

// Given operador de plataforma autenticado (isPlataformaOperador === true,
// checado exclusivamente por exigirOperadorDePlataforma() — nunca can(),
// AD-13), when cria uma conta com nome/CNPJ/plano/status -> só a linha de
// Conta é criada, fiel ao mockup (Decisão confirmada no Intent) — sem
// usuário/perfis para ela.
export async function criarContaAction(
  _estadoAnterior: EstadoAcaoConta,
  formData: FormData,
): Promise<EstadoAcaoConta> {
  await exigirOperadorDePlataforma();

  const { nome, cnpj, planoContratado, status, erros } = lerCampos(formData);
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  try {
    await criarConta({ nome, cnpj, planoContratado, status });
  } catch (erro) {
    if (isErroDeCnpjDuplicado(erro)) {
      return {
        ok: false,
        error: [{ field: "cnpj", message: "Este CNPJ já está em uso na plataforma." }],
      };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/contas");
  return { ok: true };
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
