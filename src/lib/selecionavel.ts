// A regra de "o que pode ser ESCOLHIDO num formulário" (29-10-2026).
//
// Vivia duplicada e, por isso, incompleta: o <select> de ativo filtrava por
// status na tela, mas `referenciasValidas` só conferia PERTENCIMENTO à conta.
// Uma requisição forjada vinculava uma emissão a um ativo Vendido ou a um item
// Arquivado — a tela escondia a opção, e tela não é defesa (Boundaries).
//
// Módulo puro, sem Prisma, para servir aos dois lados: o componente monta as
// opções com `opcoesSelecionaveis` e a Server Action valida com
// `validarEscolha`. Mesma lista nos dois, que é o que impede a tela de
// oferecer o que o servidor recusa.
//
// `src/lib/responsavel.ts` é a especialização deste módulo para usuários, onde
// a lista de status aceitáveis é mais estreita.

/// O status que torna um registro escolhível. Todas as entidades do produto
/// usam a mesma palavra — `Ativo` — mesmo tendo enums diferentes no banco
/// (StatusAtivo tem Bloqueado e Vendido, StatusItemRevisional tem Arquivado).
export const STATUS_SELECIONAVEL = "Ativo";

export type ComStatus = { id: string; status: string };

/// As opções de um `<select>`.
///
/// `atualId` é o que o registro JÁ referencia, e ele continua na lista mesmo
/// que tenha saído de circulação depois. Sem essa exceção, arquivar um item
/// tornaria ineditável toda emissão que o usa — o defeito da Story 7.5,
/// repetido em outra tela.
export function opcoesSelecionaveis<T extends ComStatus>(
  itens: readonly T[],
  atualId: string | null,
  statusAceitos: readonly string[] = [STATUS_SELECIONAVEL],
): T[] {
  return itens.filter((item) => statusAceitos.includes(item.status) || item.id === atualId);
}

export type MensagensDeEscolha = {
  field: string;
  /// Para um id que NÃO pertence à conta. Nunca diz que ele existe em outro
  /// lugar (AD-1).
  invalido: string;
  /// Para um id da conta que saiu de circulação. Acionável de propósito: a
  /// pessoa precisa escolher outro ou reativar o registro.
  indisponivel: string;
};

/// A contraparte no servidor. Devolve os erros de campo — lista vazia quando
/// está tudo certo.
///
/// Id vazio NÃO é erro aqui: campo obrigatório é outra validação, e tratar os
/// dois no mesmo lugar produziria duas mensagens para a mesma falta.
export function validarEscolha(
  itens: readonly ComStatus[],
  id: string,
  atualId: string | null,
  mensagens: MensagensDeEscolha,
  statusAceitos: readonly string[] = [STATUS_SELECIONAVEL],
): { field: string; message: string }[] {
  if (!id) return [];

  const item = itens.find((candidato) => candidato.id === id);
  if (!item) return [{ field: mensagens.field, message: mensagens.invalido }];

  // MANTER o que já estava gravado é o que preserva a editabilidade do
  // registro antigo — a regra nova vale para a ESCOLHA, não para o histórico.
  if (id === atualId) return [];
  if (!statusAceitos.includes(item.status)) {
    return [{ field: mensagens.field, message: mensagens.indisponivel }];
  }
  return [];
}
