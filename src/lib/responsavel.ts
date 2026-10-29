import type { StatusUsuario } from "@prisma/client";

import {
  opcoesSelecionaveis,
  validarEscolha,
  type MensagensDeEscolha,
} from "@/src/lib/selecionavel";

// Quem pode ser RESPONSÁVEL por um plano revisional ou por uma emissão
// (diferido da Story 6.3, fechado em 27-10-2026).
//
// O buraco que isto fecha: `listarUsuarios(contaId)` devolve os três status
// de propósito — a tela de Usuários filtra e permite reativar — e a
// validação das actions só conferia PERTENCIMENTO à conta. Resultado: uma
// pessoa desativada continuava oferecida no seletor e aceita na gravação.
//
// Em 29-10-2026 virou ESPECIALIZAÇÃO de `src/lib/selecionavel.ts`: a mesma
// falta apareceu em ativo e item revisional, e manter três cópias da regra é
// o que fez a terceira nascer incompleta. O que sobra aqui é só o que é
// específico de usuário — a lista de status e as mensagens.

/// Status que podem RECEBER responsabilidade. Deliberadamente mais estreita
/// que `STATUS_COM_LOGIN`: `ConvitePendente` é quem ainda não entrou, e
/// atribuir responsabilidade a quem não aceitou o convite é prometer o que
/// não se tem.
const STATUS_PODE_SER_RESPONSAVEL: readonly StatusUsuario[] = ["Ativo"];

export const ERRO_RESPONSAVEL_INVALIDO = "Selecione um responsável válido.";
export const ERRO_RESPONSAVEL_INATIVO =
  "Este responsável não está mais ativo na conta. Escolha outro.";

const MENSAGENS: MensagensDeEscolha = {
  field: "responsavelId",
  invalido: ERRO_RESPONSAVEL_INVALIDO,
  indisponivel: ERRO_RESPONSAVEL_INATIVO,
};

export type UsuarioComStatus = { id: string; status: StatusUsuario };

/// As opções do `<select>` de responsável. O responsável JÁ gravado continua
/// na lista mesmo desativado depois — ver `opcoesSelecionaveis`.
export function opcoesDeResponsavel<T extends UsuarioComStatus>(
  usuarios: readonly T[],
  responsavelAtualId: string | null,
): T[] {
  return opcoesSelecionaveis(usuarios, responsavelAtualId, STATUS_PODE_SER_RESPONSAVEL);
}

/// A contraparte no servidor.
export function validarResponsavel(
  usuarios: readonly UsuarioComStatus[],
  responsavelId: string,
  responsavelAtualId: string | null,
): { field: string; message: string }[] {
  return validarEscolha(
    usuarios,
    responsavelId,
    responsavelAtualId,
    MENSAGENS,
    STATUS_PODE_SER_RESPONSAVEL,
  );
}
