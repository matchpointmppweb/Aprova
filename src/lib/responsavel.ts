import type { StatusUsuario } from "@prisma/client";

// Quem pode ser RESPONSÁVEL por um plano revisional ou por uma emissão
// (diferido da Story 6.3, fechado em 27-10-2026).
//
// O buraco que isto fecha: `listarUsuarios(contaId)` devolve os três status
// de propósito — a tela de Usuários filtra e permite reativar — e a
// validação das actions só conferia PERTENCIMENTO à conta. Resultado: uma
// pessoa desativada continuava oferecida no seletor e aceita na gravação.
//
// Módulo puro (só o tipo do Prisma, nunca o cliente), para servir aos dois
// lados sem duplicar a regra: o `<select>` usa `opcoesDeResponsavel` e a
// Server Action usa `validarResponsavel`. É a mesma lista nos dois, que é o
// que impede a tela de oferecer o que o servidor recusa.

/// Status que podem RECEBER responsabilidade. Deliberadamente mais estreita
/// que `STATUS_COM_LOGIN`: `ConvitePendente` é quem ainda não entrou, e
/// atribuir responsabilidade a quem não aceitou o convite é prometer o que
/// não se tem.
const STATUS_PODE_SER_RESPONSAVEL: readonly StatusUsuario[] = ["Ativo"];

export const ERRO_RESPONSAVEL_INVALIDO = "Selecione um responsável válido.";
export const ERRO_RESPONSAVEL_INATIVO =
  "Este responsável não está mais ativo na conta. Escolha outro.";

export type UsuarioComStatus = { id: string; status: StatusUsuario };

function podeReceber(usuario: UsuarioComStatus): boolean {
  return STATUS_PODE_SER_RESPONSAVEL.includes(usuario.status);
}

/// As opções do `<select>` de responsável.
///
/// `responsavelAtualId` é quem o registro JÁ referencia, e ele continua na
/// lista mesmo desativado depois. Sem essa exceção, editar um plano antigo
/// cujo responsável foi desativado esvaziaria o seletor e o formulário
/// passaria a recusar — exatamente o defeito que tornou a emissão
/// permanentemente ineditável na Story 7.5, repetido em outra tela.
export function opcoesDeResponsavel<T extends UsuarioComStatus>(
  usuarios: readonly T[],
  responsavelAtualId: string | null,
): T[] {
  return usuarios.filter(
    (usuario) => podeReceber(usuario) || usuario.id === responsavelAtualId,
  );
}

/// A contraparte no servidor. Devolve os erros de campo — lista vazia quando
/// está tudo certo.
///
/// Dois desfechos distintos de propósito: quem não é da conta é "inválido"
/// (nunca dizemos que existe em outro lugar, AD-1) e quem é da conta mas
/// está inativo recebe a mensagem que explica o que houve, porque é
/// acionável — a pessoa precisa escolher outro ou reativar o usuário.
export function validarResponsavel(
  usuarios: readonly UsuarioComStatus[],
  responsavelId: string,
  responsavelAtualId: string | null,
): { field: string; message: string }[] {
  if (!responsavelId) return [];

  const usuario = usuarios.find((candidato) => candidato.id === responsavelId);
  if (!usuario) {
    return [{ field: "responsavelId", message: ERRO_RESPONSAVEL_INVALIDO }];
  }
  // MANTER o responsável que já estava gravado é o que preserva a
  // editabilidade do registro antigo — a regra nova vale para a ESCOLHA, não
  // para o histórico.
  if (responsavelId === responsavelAtualId) return [];
  if (!podeReceber(usuario)) {
    return [{ field: "responsavelId", message: ERRO_RESPONSAVEL_INATIVO }];
  }
  return [];
}
