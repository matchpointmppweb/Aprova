// Leitura e limite de campos de texto vindos de FormData (29-10-2026).
//
// Dois diferidos abertos desde a Story 1.3/2.1, que são o mesmo problema:
//
// 1. `String(formData.get("nome") ?? "")` não checa o TIPO. `FormData.get`
//    devolve `string | File | null`, e um POST forjado com um arquivo no
//    lugar do campo vira a string literal "[object File]" — gravada como se
//    fosse o nome digitado, em vez de recusada.
//
// 2. Nenhum campo de texto do produto tinha limite de tamanho. Nada impedia
//    um nome de dois megabytes: atravessava a validação, entrava no banco
//    (Postgres `text` não tem teto) e quebrava toda listagem que o exibisse.
//
// O teto é validado NO SERVIDOR, e o `maxLength` do input é só conveniência
// — Boundaries: validação de cliente nunca é defesa.

/// Nome, razão social, título: uma linha curta.
export const LIMITE_NOME = 120;
/// Descrição, endereço, localização: uma linha longa.
export const LIMITE_DESCRICAO = 500;
/// Observação, motivo de reprovação: texto livre de parágrafo.
export const LIMITE_TEXTO_LONGO = 2000;
/// CPF/CNPJ, já reduzidos a dígitos na leitura — 14 é o CNPJ, e a folga
/// existe só para a mensagem sair antes de um valor absurdo.
export const LIMITE_DOCUMENTO = 20;

export function erroDeTamanho(rotulo: string, limite: number): string {
  return `${rotulo} deve ter no máximo ${limite} caracteres.`;
}

/// Lê um campo de texto do FormData.
///
/// Um `File` devolve string vazia, nunca "[object File]": o campo passa a
/// contar como NÃO PREENCHIDO e cai na validação de obrigatório que já
/// existe, em vez de ser gravado como um nome absurdo. Tratar como vazio, e
/// não como erro próprio, mantém uma mensagem só por campo.
export function lerTexto(formData: FormData, nome: string): string {
  const bruto = formData.get(nome);
  return typeof bruto === "string" ? bruto.trim() : "";
}

/// Igual a `lerTexto`, sem aparar as pontas — para os poucos campos em que o
/// espaço digitado é significativo (senha).
export function lerTextoBruto(formData: FormData, nome: string): string {
  const bruto = formData.get(nome);
  return typeof bruto === "string" ? bruto : "";
}

/// O teto de um campo. Devolve erro de campo, nunca trunca: truncar grava um
/// valor que a pessoa não escreveu e não avisa ninguém (NFR7 — recusa é
/// recusa).
export function validarTamanho(
  valor: string | null | undefined,
  limite: number,
  field: string,
  rotulo: string,
): { field: string; message: string }[] {
  if (!valor) return [];
  // `Array.from` conta PONTOS DE CÓDIGO, não unidades UTF-16: com `.length`,
  // um nome de emojis contaria em dobro e o limite mudaria conforme o
  // alfabeto.
  if (Array.from(valor).length <= limite) return [];
  return [{ field, message: erroDeTamanho(rotulo, limite) }];
}
