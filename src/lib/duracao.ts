// Duração de um lançamento de serviço (Story 7.2). Módulo PURO de propósito:
// nada de Prisma, React ou `server-only`. Quem consome são a tela da 7.3 (que
// interpreta o que a pessoa digita) e a listagem da 7.4 (que formata e soma) —
// duas fronteiras diferentes, e nenhuma delas é lugar para a regra viver.
// Sendo puro, ele é testável sem banco e sem render, que é a razão de a suíte
// desta story rodar em milissegundos.

// Teto de um lançamento: 31 dias. Um lançamento é o trabalho de UMA pessoa num
// item — 31 dias é grande o bastante para nunca recusar trabalho legítimo e
// pequeno o bastante para barrar o absurdo. Sem ele, o limite real seria o
// INTEGER do Postgres (2,1 bilhões de minutos, quatro mil anos), que quebra
// qualquer soma e qualquer exibição.
//
// Por que não algo apertado como 24h, que pegaria mais erro de digitação: o
// modo `Periodo` guarda DATAS, não minutos, e expressa naturalmente um serviço
// de três dias. Um teto de 24h só na duração tornaria o mesmo fato registrável
// num modo e proibido no outro.
//
// ASSIMETRIA REGISTRADA: no BANCO o teto vale hoje só para o ramo `Duracao` da
// CHECK. O ramo `Periodo` não impõe nada sobre `inicio`/`fim`, então um período
// de dez anos é gravável por SQL cru, embora `duracaoDoPeriodo` o recuse — o
// módulo é mais estrito que o banco nesse caminho. Não é descuido: a 7.1 deixou
// o ramo `Periodo` frouxo de propósito (a UI de hoje ainda produz linha sem
// datas), e apertá-lo exige primeiro a Story 7.3, que passa a exigir os dois
// marcos e valida o intervalo ANTES de o banco precisar recusar. Enquanto isso,
// nenhum caminho da aplicação grava período fora do teto, porque todos passam
// por aqui.
//
// ESTE NÚMERO É A FONTE ÚNICA. A cláusula da CHECK
// `servicos_emissao_modo_coerente` (migration 20260922150000) usa o mesmo
// 44640; divergir recria em silêncio o problema que esta story fecha, e é o
// teste `tests/servico-emissao.test.ts` que guarda a igualdade.
export const TETO_DE_MINUTOS = 44_640;

// Recusa DISCRIMINADA, no padrão de `ResolucaoDeVinculo` (Epic 6): o campo
// `tipo` obriga o chamador a distinguir recusa de valor. `number | null` seria
// o erro oposto — confundiria "recusado" com "zero", e zero não é lançamento
// (NFR7). O motivo não é decoração: são quatro mensagens diferentes que a 7.3
// precisa exibir no campo certo.
export type MotivoDeRecusa =
  /// Não é uma duração: texto vazio, sem sentido, negativo, ou minutos fora de
  /// 0–59 (`"1:70"` NUNCA vira 130).
  | "formato-invalido"
  /// Zero. Sintaticamente válido, semanticamente não é lançamento (NFR7).
  | "nao-positivo"
  /// Acima de TETO_DE_MINUTOS.
  | "acima-do-teto"
  /// Só no modo período: fim anterior ao início. Nunca vira 0 (AD-30).
  | "periodo-invertido";

export type ResultadoDeDuracao =
  | { tipo: "ok"; minutos: number }
  | { tipo: "recusado"; motivo: MotivoDeRecusa };

// `1:55`, `1h55`, `1H55`, `1:5`, com ou sem espaços em volta e em volta do
// separador; ou só as horas (`1h`, `2`).
//
// Até 7 dígitos de hora, e o limite é sobre a PRECISÃO, não sobre a regra: 7
// dígitos em minutos ainda cabem folgadamente no inteiro exato de um `number`.
// Quem recusa número grande é `avaliar`, com o motivo certo — "10000" é uma
// duração perfeitamente legível que simplesmente passa do teto, e devolver
// `formato-invalido` ali diria à pessoa que ela digitou errado quando o que
// falhou foi o limite.
const COM_SEPARADOR = /^(\d{1,7})\s*[:hH]\s*(\d{1,2})?$/;
const SO_HORAS = /^(\d{1,7})$/;

/// Interpreta o texto digitado. Diverge do mockup (`parseHorasTexto`,
/// Mockups/atual.html L2225) em tudo o que lá devolvia `0`: entrada inválida
/// aqui é recusa explícita, porque um `0` silencioso some no total (NFR7).
export function interpretarDuracao(texto: string): ResultadoDeDuracao {
  const limpo = texto.trim();
  const achado = COM_SEPARADOR.exec(limpo) ?? SO_HORAS.exec(limpo);
  if (!achado) return { tipo: "recusado", motivo: "formato-invalido" };

  const horas = Number(achado[1]);
  const minutos = achado[2] === undefined ? 0 : Number(achado[2]);
  // `"1:70"` casa com a regex (dois dígitos) mas não é hora nenhuma. Recusar
  // aqui, e não normalizar para 2:10, é o ponto: quem digitou 70 errou, e o
  // sistema não adivinha o que quis dizer.
  if (minutos > 59) return { tipo: "recusado", motivo: "formato-invalido" };

  return avaliar(horas * 60 + minutos);
}

/// Calcula a duração entre dois marcos do modo período. Não existe
/// `minutosEntreHoras` (a "virada de dia" do mockup): aqui os marcos são
/// data+hora completas, então a virada já está resolvida pelas datas — inventar
/// o salto de 24h transformaria período invertido em duração plausível.
export function duracaoDoPeriodo(inicio: Date, fim: Date): ResultadoDeDuracao {
  const a = inicio.getTime();
  const b = fim.getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return { tipo: "recusado", motivo: "formato-invalido" };
  }
  if (b < a) return { tipo: "recusado", motivo: "periodo-invertido" };
  // Arredondar para o minuto é DELIBERADO, e tem consequência deliberada: um
  // período abaixo de 30 segundos vira 0 e cai em `nao-positivo`. A unidade do
  // domínio é o minuto inteiro (AD-28) — um lançamento de 20 segundos não tem
  // como ser gravado, exibido nem somado, então recusá-lo é a resposta honesta.
  // Não ganha motivo próprio de propósito: para quem preenche, "isso não é uma
  // duração positiva" é exatamente o que aconteceu.
  return avaliar(Math.round((b - a) / 60_000));
}

// As duas regras que valem para os dois modos, num lugar só.
function avaliar(minutos: number): ResultadoDeDuracao {
  if (minutos <= 0) return { tipo: "recusado", motivo: "nao-positivo" };
  if (minutos > TETO_DE_MINUTOS) return { tipo: "recusado", motivo: "acima-do-teto" };
  return { tipo: "ok", minutos };
}

/// O que a tela mostra quando o número recebido não é uma duração: negativo ou
/// não finito. É curto, não se confunde com hora nenhuma e não soma com nada —
/// ao contrário de `"0:00"`, que some no meio da coluna, e de `"NaN:NaN"`, que
/// parece defeito de render. Nenhum dos dois casos deveria existir (a CHECK
/// barra negativo, e `somarMinutos` só recebe inteiros do banco); se um
/// aparecer, é dado corrompido, e o lugar de descobrir isso é a tela.
export const DURACAO_INVALIDA = "—";

/// Formata minutos como `H:MM`. Acima de 24h SEGUE em horas (`1500` → `"25:00"`)
/// — quem lê um lançamento quer comparar com as outras horas da emissão, e
/// "1d 1:00" obrigaria a converter de cabeça para somar.
export function formatarMinutos(minutos: number): string {
  // Sem `Math.max(0, ...)` aqui: engolir negativo em `"0:00"` seria o mesmo
  // zero silencioso que o resto do módulo recusa, só que no caminho da leitura.
  if (!Number.isFinite(minutos) || minutos < 0) return DURACAO_INVALIDA;
  const inteiro = Math.round(minutos);
  return `${Math.floor(inteiro / 60)}:${String(inteiro % 60).padStart(2, "0")}`;
}

/// Soma os minutos já gravados. Recebe a lista pronta porque o total é SEMPRE
/// derivado na leitura, nunca coluna (AD-29): não há o que invalidar quando um
/// lançamento muda. Lista vazia é 0 — aqui zero é a ausência de lançamentos, o
/// único zero legítimo deste módulo.
export function somarMinutos(lancamentos: readonly number[]): number {
  return lancamentos.reduce((total, minutos) => total + minutos, 0);
}
