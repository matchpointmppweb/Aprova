// Tipo e estado inicial compartilhados pelas Server Actions de Emissão —
// mesma convenção { ok, data?, error? } de plano-estado.ts/
// item-revisional-estado.ts (Consistency Conventions da arquitetura).
//
// Fica fora de actions/emissao.ts porque um módulo "use server" só pode
// exportar funções assíncronas — nenhuma constante ou tipo (mesmo motivo de
// plano-estado.ts).
import type { Setor } from "@prisma/client";

import {
  duracaoDoPeriodo,
  formatarMinutos,
  interpretarDuracao,
  somarMinutos,
  TETO_DE_MINUTOS,
  type MotivoDeRecusa,
  type ResultadoDeDuracao,
} from "@/src/lib/duracao";

export type ErroDeValidacao = { field: string; message: string };

export type EstadoAcaoEmissao<T = undefined> = {
  ok: boolean;
  data?: T;
  error?: string | ErroDeValidacao[];
};

export const estadoInicialAcaoEmissao: EstadoAcaoEmissao = { ok: false };

// Mensagem exibida quando o `updatedAt` enviado pelo formulário não bate com
// o valor atual da emissão no banco (lock otimista, AD-9) — Boundaries/I-O
// Matrix: "Conflito de edição".
export const ERRO_CONFLITO_EDICAO =
  "Conflito de edição — os dados foram alterados por outra pessoa. Recarregue e tente de novo.";

// Mensagem exibida quando uma transição de status (Story 4.2) é tentada a
// partir de um estado de origem que já não é mais o atual (ex.: aprovar uma
// emissão que não está mais EmAnalise) — distinto de ERRO_CONFLITO_EDICAO
// (que cobre updatedAt divergente com o status de origem ainda batendo,
// I/O Matrix: "Transição inválida").
export const ERRO_TRANSICAO_INVALIDA =
  "Esta emissão já mudou de status. Recarregue e tente de novo.";

// Achata o erro (string única ou array de erros por campo) numa mensagem
// exibível na UI, sem expor detalhe interno (Boundaries: erros nunca expõem
// detalhe de constraint/banco). Mesma função de plano-estado.ts.
export function mensagemDeErro(erro: EstadoAcaoEmissao["error"]): string | undefined {
  if (!erro) return undefined;
  if (typeof erro === "string") return erro;
  return erro.map((item) => item.message).join(" ");
}

export type ItemRevisionalReal = {
  id: string;
  nome: string;
  diasPadrao: number | null;
  kmPadrao: number | null;
  horasPadrao: number | null;
};

export type ItemDoPlanoVigente = {
  itemRevisionalId: string;
  diasOverride: number | null;
  kmOverride: number | null;
  horasOverride: number | null;
};

// Snapshot do valor esperado no momento em que o item entra na emissão
// (Boundaries): override do PlanoItemRevisional ?? padrão do ItemRevisional.
// Usado só na criação e na troca de plano da edição — uma edição posterior
// ao Plano/Item revisional de origem nunca reexecuta esta função para os
// itens já gravados (o repositório nunca toca valorEsperado* no fluxo
// update-in-place).
export function calcularValorEsperado(
  itemDoPlano: ItemDoPlanoVigente,
  itemReal: ItemRevisionalReal | undefined,
) {
  return {
    valorEsperadoDias: itemDoPlano.diasOverride ?? itemReal?.diasPadrao ?? null,
    valorEsperadoKm: itemDoPlano.kmOverride ?? itemReal?.kmPadrao ?? null,
    valorEsperadoHoras: itemDoPlano.horasOverride ?? itemReal?.horasPadrao ?? null,
  };
}

// Setores válidos (Story 5.5) — espelha o enum `Setor` do schema. Fixo, sem
// tela de gestão e FORA do enum `Modulo` (AD-15). O `satisfies` amarra a
// lista ao enum gerado pelo Prisma: acrescentar um valor no schema sem
// refletir aqui quebra o build.
export const SETORES = [
  "Manutencao",
  "Producao",
  "Logistica",
  "SegurancaDoTrabalho",
  "Administrativo",
] as const satisfies readonly Setor[];

export const SETOR_PADRAO: Setor = "Manutencao";

// Rótulo exibível de cada setor (o enum usa identificadores sem acento/
// espaço porque valores de enum Prisma não os aceitam).
export const LABEL_POR_SETOR: Record<Setor, string> = {
  Manutencao: "Manutenção",
  Producao: "Produção",
  Logistica: "Logística",
  SegurancaDoTrabalho: "Segurança do trabalho",
  Administrativo: "Administrativo",
};

export function isSetorValido(valor: string): valor is Setor {
  return (SETORES as readonly string[]).includes(valor);
}

// Uma linha da aba "Serviço" já lida do FormData, ainda como texto cru — a
// validação/parse acontece em validarServicos abaixo.
export type LinhaServicoBruta = {
  indice: number;
  pessoaId: string;
  itemRevisionalId: string;
  /// Cru do <select> de modo (`Duracao` | `Periodo`). String, não o enum: o
  /// valor vem do cliente e um request adulterado nunca é tratado como enum
  /// válido sem passar por isModoValido.
  modo: string;
  /// Texto digitado no modo `Duracao` ("1:55"). Nunca minutos: o cliente jamais
  /// envia total calculado (AD-29), o servidor reinterpreta o texto.
  horas: string;
  inicio: string;
  fim: string;
};

// Linhas da aba "Serviço" (Story 5.5). Convenção do Boundaries: contagem
// explícita em `servicoCount` + campos indexados `servico-{i}-*` — NUNCA
// getAll() posicional, que embaralharia as colunas quando um campo vem
// vazio/desabilitado. Um índice cuja linha não tem NENHUM campo preenchido
// é ignorado (linha fantasma), mas uma linha parcialmente preenchida cai na
// validação de campo obrigatório de validarServicos.
export const MAX_LINHAS_SERVICO = 200;

// Acima do teto a requisição é REJEITADA, nunca truncada: truncar salvaria
// um subconjunto silencioso das linhas enviadas e ainda responderia ok.
export const ERRO_EXCESSO_SERVICOS = `Uma emissão aceita no máximo ${MAX_LINHAS_SERVICO} serviços.`;

// Vive aqui, e não em actions/emissao.ts, porque um módulo "use server" só pode
// exportar função assíncrona — e o contrato de NOMES do FormData
// (`servico-{i}-modo`, `-horas`, ...) precisa ser testável contra os mesmos
// nomes que o componente renderiza: renomear só um dos dois lados não é erro de
// compilação (são template strings), e sem teste a suíte ficaria verde com a
// funcionalidade quebrada.
export function lerServicos(
  formData: FormData,
): { ok: true; linhas: LinhaServicoBruta[] } | { ok: false; erro: string } {
  const totalBruto = Number(String(formData.get("servicoCount") ?? "0").trim());
  if (!Number.isFinite(totalBruto) || !Number.isInteger(totalBruto) || totalBruto <= 0) {
    return { ok: true, linhas: [] };
  }
  if (totalBruto > MAX_LINHAS_SERVICO) {
    return { ok: false, erro: ERRO_EXCESSO_SERVICOS };
  }
  const total = totalBruto;

  const linhas: LinhaServicoBruta[] = [];
  for (let indice = 0; indice < total; indice++) {
    const pessoaId = String(formData.get(`servico-${indice}-pessoaId`) ?? "").trim();
    const itemRevisionalId = String(
      formData.get(`servico-${indice}-itemRevisionalId`) ?? "",
    ).trim();
    // Story 7.3: o modo e o texto de horas viajam pelos mesmos nomes indexados.
    // `modo` fica FORA da checagem de linha fantasma de propósito — o <select>
    // sempre manda um valor, então incluí-lo faria toda linha em branco parecer
    // preenchida e virar erro de campo obrigatório.
    const modo = String(formData.get(`servico-${indice}-modo`) ?? "").trim();
    const horas = String(formData.get(`servico-${indice}-horas`) ?? "").trim();
    const inicio = String(formData.get(`servico-${indice}-inicio`) ?? "").trim();
    const fim = String(formData.get(`servico-${indice}-fim`) ?? "").trim();

    if (!pessoaId && !itemRevisionalId && !horas && !inicio && !fim) continue;
    linhas.push({ indice, pessoaId, itemRevisionalId, modo, horas, inicio, fim });
  }
  return { ok: true, linhas };
}

// Story 7.3 — união DISCRIMINADA por `modo`, espelhando DadosServicoEmissao do
// repositório: o tipo torna inexprimível a linha `Duracao` com datas e a linha
// `Periodo` sem marcos. Os dois marcos deixam de ser `Date | null` porque a
// validação passou a EXIGIR os dois no modo período (I/O Matrix: "Período
// incompleto").
export type ServicoValidado =
  | { pessoaId: string; itemRevisionalId: string; modo: "Duracao"; duracaoMinutos: number }
  | { pessoaId: string; itemRevisionalId: string; modo: "Periodo"; inicio: Date; fim: Date };

export const MODOS_DE_LANCAMENTO = ["Duracao", "Periodo"] as const;
export type ModoDeLancamento = (typeof MODOS_DE_LANCAMENTO)[number];

export function isModoValido(valor: string): valor is ModoDeLancamento {
  return (MODOS_DE_LANCAMENTO as readonly string[]).includes(valor);
}

// Input type="datetime-local" manda "YYYY-MM-DDTHH:mm" (ou com segundos).
// O valor é interpretado como wall-clock UTC (Date.UTC) — NUNCA pelo fuso
// local do processo: `new Date("YYYY-MM-DDTHH:mm:ss")` usa o fuso do
// servidor (UTC na Vercel) enquanto o cliente monta a string com getters
// locais (UTC-3), e essa assimetria deslocava a hora a cada ida e volta.
// paraDatetimeLocal (components/emissao/modal-emissao.tsx) renderiza de
// volta com os getters getUTC*, fechando o round trip: o que fica gravado é
// exatamente o relógio de parede que o usuário digitou.
// Decisão consciente e seu limite: o produto é single-timezone pt-BR
// (internacionalização é non-goal explícito do SPEC). Se algum dia atender
// múltiplos fusos, isto precisa ser revisto (guardar o offset/fuso de
// origem, ou converter de verdade para instante UTC).
//
// Confirma que os componentes do resultado batem com a string original, para
// um dia de calendário inexistente ("2024-02-30", que Date.UTC normalizaria
// em silêncio) ou uma hora impossível ("T25:00") serem rejeitados como valor
// inválido em vez de virarem outra data.
//
// Retorna `null` para string vazia (campo opcional não preenchido) e
// `"invalido"` para um valor malformado — os dois casos são distintos: o
// primeiro grava null, o segundo vira erro de campo (I/O Matrix: "Data/hora
// inválida").
export function parseDataHora(bruto: string): Date | null | "invalido" {
  const valor = bruto.trim();
  if (!valor) return null;

  const partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(valor);
  if (!partes) return "invalido";

  const [, ano, mes, dia, hora, minuto, segundo] = partes;
  const data = new Date(
    Date.UTC(
      Number(ano),
      Number(mes) - 1,
      Number(dia),
      Number(hora),
      Number(minuto),
      Number(segundo ?? "00"),
    ),
  );
  if (Number.isNaN(data.getTime())) return "invalido";

  const bate =
    data.getUTCFullYear() === Number(ano) &&
    data.getUTCMonth() + 1 === Number(mes) &&
    data.getUTCDate() === Number(dia) &&
    data.getUTCHours() === Number(hora) &&
    data.getUTCMinutes() === Number(minuto);
  return bate ? data : "invalido";
}

// Campos Gerais obrigatórios (I/O Matrix: "Criação feliz" exige
// ativo+plano+responsável+data válidos). Vínculo cross-tenant de cada id é
// checado à parte pela Server Action (contra os dados reais da conta),
// mesmo padrão de vinculoEResponsavelValidos em actions/plano.ts.
//
// Story 5.5: `setor` é obrigatório (o <select> sempre manda um valor e o
// banco tem default, mas um request adulterado com valor fora do enum é
// rejeitado aqui, nunca chega ao Prisma) e os três marcos de data/hora são
// OPCIONAIS — só um valor malformado vira erro de campo, ausência nunca vira.
export function validarCamposGerais(campos: {
  ativoId: string;
  planoId: string;
  responsavelId: string;
  dataEmissao: Date | null;
  setor: string;
  dataAgendamento: Date | null | "invalido";
  dataInicio: Date | null | "invalido";
  dataFim: Date | null | "invalido";
}): ErroDeValidacao[] {
  const erros: ErroDeValidacao[] = [];
  if (!campos.ativoId) {
    erros.push({ field: "ativoId", message: "Selecione um ativo." });
  }
  if (!campos.planoId) {
    erros.push({ field: "planoId", message: "Selecione um plano revisional." });
  }
  if (!campos.responsavelId) {
    erros.push({ field: "responsavelId", message: "Selecione um responsável." });
  }
  if (!campos.dataEmissao || Number.isNaN(campos.dataEmissao.getTime())) {
    erros.push({ field: "dataEmissao", message: "Informe a data de emissão." });
  }
  if (!isSetorValido(campos.setor)) {
    erros.push({ field: "setor", message: "Selecione um setor válido." });
  }
  if (campos.dataAgendamento === "invalido") {
    erros.push({ field: "dataAgendamento", message: "Informe uma data de agendamento válida." });
  }
  if (campos.dataInicio === "invalido") {
    erros.push({ field: "dataInicio", message: "Informe uma data de início válida." });
  }
  if (campos.dataFim === "invalido") {
    erros.push({ field: "dataFim", message: "Informe uma data de fim válida." });
  }
  // Ordem cronológica: só checável quando os dois marcos estão preenchidos e
  // válidos (ambos são opcionais).
  if (
    campos.dataInicio instanceof Date &&
    campos.dataFim instanceof Date &&
    campos.dataFim.getTime() < campos.dataInicio.getTime()
  ) {
    erros.push({ field: "dataFim", message: "A data de fim não pode ser anterior à de início." });
  }
  return erros;
}

// Teto escrito com a MESMA função que formata o total na tela (7.2) — nenhum
// "744" literal na mensagem: mudar TETO_DE_MINUTOS muda o texto sozinho.
const TETO_FORMATADO = formatarMinutos(TETO_DE_MINUTOS);

// Os quatro motivos de MotivoDeRecusa viram quatro mensagens distintas
// (Boundaries) — e DUAS tabelas, porque a mesma recusa quer dizer coisas
// diferentes nos dois modos: "não positivo" é "digite mais que zero" quando a
// pessoa digitou o texto, e "o fim precisa ser depois do início" quando ela
// escolheu dois marcos. Um mapa só forçaria uma das duas a mentir.
const MENSAGEM_POR_MOTIVO_HORAS: Record<MotivoDeRecusa, string> = {
  "formato-invalido": "Informe as horas no formato 1:55.",
  "nao-positivo": "As horas do serviço precisam ser maiores que zero.",
  "acima-do-teto": `O serviço não pode passar de ${TETO_FORMATADO}.`,
  // Inalcançável por interpretarDuracao (não existe período aqui); presente
  // porque o Record é exaustivo — acrescentar um motivo na 7.2 quebra a
  // compilação aqui, que é o ponto.
  "periodo-invertido": "Informe as horas no formato 1:55.",
};

const MENSAGEM_POR_MOTIVO_PERIODO: Record<MotivoDeRecusa, string> = {
  "formato-invalido": "Informe um período de serviço válido.",
  "nao-positivo": "O fim do serviço precisa ser depois do início.",
  "acima-do-teto": `O período do serviço não pode passar de ${TETO_FORMATADO}.`,
  "periodo-invertido": "O fim do serviço não pode ser anterior ao início.",
};

// Total DERIVADO de uma linha da aba Serviço (AD-29), na forma que a TELA
// precisa: minutos a cada tecla, antes de qualquer submit, a partir do texto
// cru dos inputs. Vive aqui, e não dentro do componente, por dois motivos:
// é a MESMA aritmética que `validarServicos` aplica logo abaixo (divergir
// faria a tela prometer um total que o servidor recusa), e dentro de um
// componente "use client" ela seria intestável — o projeto não tem render de
// componente em teste.
//
// Recusa é recusa: uma linha que o módulo não aceita NUNCA vale zero (NFR7).
// A célula exibe DURACAO_INVALIDA e a linha simplesmente não entra na soma,
// em vez de contribuir com o zero silencioso que o mockup produz.
export type LinhaServicoDerivavel = {
  modo: ModoDeLancamento;
  horas: string;
  inicio: string;
  fim: string;
};

export function minutosDaLinhaDeServico(linha: LinhaServicoDerivavel): ResultadoDeDuracao {
  if (linha.modo === "Duracao") return interpretarDuracao(linha.horas);

  const inicio = parseDataHora(linha.inicio);
  const fim = parseDataHora(linha.fim);
  // Período ainda incompleto ou malformado — nada a somar, e nunca "0:00".
  if (!(inicio instanceof Date) || !(fim instanceof Date)) {
    return { tipo: "recusado", motivo: "formato-invalido" };
  }
  return duracaoDoPeriodo(inicio, fim);
}

// Horas acumuladas do rodapé (AD-29): soma SÓ as linhas que o módulo aceita.
// Lista vazia soma 0, e esse "0:00" é o único zero honesto da tela.
export function minutosAcumuladosDeServico(linhas: readonly LinhaServicoDerivavel[]): number {
  const minutos: number[] = [];
  for (const linha of linhas) {
    const resultado = minutosDaLinhaDeServico(linha);
    if (resultado.tipo === "ok") minutos.push(resultado.minutos);
  }
  return somarMinutos(minutos);
}

// ---------------------------------------------------------------------------
// Story 7.4 — estado DERIVADO de um item da aba Itens (AD-31)
// ---------------------------------------------------------------------------
// Três níveis computados na LEITURA, a partir de `executado` mais a existência
// de lançamentos daquele item. Nunca coluna no banco, nunca campo editável:
// acrescentar um terceiro lugar para a mesma verdade é como o estado passa a
// mentir depois da primeira remoção de lançamento.
//
// Vive aqui, e não dentro do componente, pelo mesmo motivo de
// `minutosDaLinhaDeServico`: regra presa num `.tsx` é regra não testada (o
// projeto não tem render de componente em teste).

export type EstadoDoItem = "pendente" | "parcial" | "concluido";

// Os rótulos do mockup (L2284). `parcial` é "Serviço apontado" e não "Parcial":
// a classe CSS herda o nome curto do mockup (AD-4), o texto diz o que a pessoa
// precisa entender.
export const LABEL_POR_ESTADO_DO_ITEM: Record<EstadoDoItem, string> = {
  pendente: "Pendente",
  parcial: "Serviço apontado",
  concluido: "Concluído",
};

// Forma mínima do que a derivação precisa de um lançamento: o item a que ele
// pertence. A chave é o `itemRevisionalId` — NUNCA o nome do item, como o
// mockup faz (L2384): dois itens homônimos misturariam lançamentos, e renomear
// um item revisional faria os dele sumirem da linha.
export type LancamentoDoItem = { itemRevisionalId: string };

export function lancamentosDoItem<T extends LancamentoDoItem>(
  lancamentos: readonly T[],
  itemRevisionalId: string,
): T[] {
  return lancamentos.filter((lancamento) => lancamento.itemRevisionalId === itemRevisionalId);
}

// Precedência, não soma (Design Notes): `executado` vence sempre, mesmo sem
// nenhum lançamento — quem marcou declarou que terminou, e o sistema não tem
// por que discordar. "Serviço apontado" existe só para o trabalho sem conclusão
// declarada.
export function estadoDerivadoDoItem(entrada: {
  itemRevisionalId: string;
  executado: boolean;
  lancamentos: readonly LancamentoDoItem[];
}): EstadoDoItem {
  if (entrada.executado) return "concluido";
  return lancamentosDoItem(entrada.lancamentos, entrada.itemRevisionalId).length > 0
    ? "parcial"
    : "pendente";
}

// ---------------------------------------------------------------------------
// Story 7.4 — validação do lançamento feito NA LINHA do item (UX-DR17)
// ---------------------------------------------------------------------------
// A caixa embutida sempre lança no modo `Periodo` (pessoa + início + fim), e
// recusa tudo o que `src/lib/duracao.ts` recusa — reusando
// `minutosDaLinhaDeServico` e a MESMA tabela de mensagens que a aba Serviço,
// para a caixa nunca aceitar um lançamento que o submit vai recusar depois.
//
// Diverge do mockup (`confirmarServicoItem`, L2410) em três pontos
// (Boundaries): o teto é aplicado, a pessoa é obrigatória, e a recusa é uma
// mensagem na própria caixa em vez de um `alert()`.
export type LancamentoDaCaixa = {
  pessoaId: string;
  inicio: string;
  fim: string;
};

export type ResultadoDaCaixa =
  | { tipo: "ok"; minutos: number }
  | { tipo: "recusado"; mensagem: string };

export function validarLancamentoDaCaixa(entrada: LancamentoDaCaixa): ResultadoDaCaixa {
  if (!entrada.pessoaId) {
    return { tipo: "recusado", mensagem: "Selecione a pessoa do serviço." };
  }
  // Marco ausente é caso próprio: `minutosDaLinhaDeServico` devolveria
  // `formato-invalido` ("período inválido"), que manda a pessoa revisar o que
  // ela simplesmente ainda não preencheu.
  if (!entrada.inicio.trim() || !entrada.fim.trim()) {
    return { tipo: "recusado", mensagem: "Informe o início e o fim do serviço." };
  }

  const resultado = minutosDaLinhaDeServico({
    modo: "Periodo",
    horas: "",
    inicio: entrada.inicio,
    fim: entrada.fim,
  });
  if (resultado.tipo === "recusado") {
    return { tipo: "recusado", mensagem: MENSAGEM_POR_MOTIVO_PERIODO[resultado.motivo] };
  }
  return { tipo: "ok", minutos: resultado.minutos };
}

// Linha da aba "Serviço" montada a partir de um lançamento da caixa embutida
// (UX-DR17). Vive aqui, e não no componente, pelo mesmo motivo das demais
// regras deste módulo: dentro do `.tsx` trocar o modo para "Duracao" ou passar
// o item errado deixaria a suíte inteira verde.
//
// Sempre `Periodo` com `horas` vazio — a caixa só oferece início e fim — e
// sempre amarrada ao `itemRevisionalId` da linha, nunca ao nome do item.
export type LinhaServicoDaCaixa = {
  pessoaId: string;
  itemRevisionalId: string;
  modo: ModoDeLancamento;
  horas: string;
  inicio: string;
  fim: string;
};

export function linhaDeServicoDaCaixa(
  itemRevisionalId: string,
  entrada: LancamentoDaCaixa,
): LinhaServicoDaCaixa {
  return {
    pessoaId: entrada.pessoaId,
    itemRevisionalId,
    modo: "Periodo",
    horas: "",
    inicio: entrada.inicio,
    fim: entrada.fim,
  };
}

// "2026-01-15T08:30" -> "15/01/2026 08:30" (mockup: formatarDataHora, L2403).
// Formatação de EXIBIÇÃO da string crua do input — nada de `new Date()` aqui,
// que reintroduziria a conversão de fuso que paraDatetimeLocal existe para
// evitar. O formato INTEIRO é validado antes: uma data incompleta antes do
// "T" renderizava "undefined/undefined/...".
export function formatarDataHoraDigitada(valor: string): string {
  const bruto = valor.trim();
  if (!bruto) return "—";
  const partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(bruto);
  if (!partes) return bruto;
  const [, ano, mes, dia, hora, minuto] = partes;
  return `${dia}/${mes}/${ano} ${hora}:${minuto}`;
}

// Valida as linhas da aba "Serviço" (Story 5.5, reescrita na 7.3). Zero linhas
// continua sendo um estado válido (Never: nunca exigir ao menos um serviço).
// Pessoa e item revisional são obrigatórios em cada linha existente; o vínculo
// cross-tenant de cada id é checado à parte pela Server Action, contra os dados
// reais da conta (AD-1), do mesmo jeito que ativo/plano/responsável.
//
// Story 7.3 — é AQUI que a recusa da NFR7 nasce: toda entrada que
// `src/lib/duracao.ts` não aceita vira erro NO CAMPO daquela linha, e uma linha
// com erro nunca entra em `servicos`. Como a Server Action aborta inteira
// quando `erros` não está vazio, nada é gravado pela metade (AD-30) — o
// contrário do mockup, que devolve `0` em cada um desses casos.
export function validarServicos(linhas: LinhaServicoBruta[]): {
  erros: ErroDeValidacao[];
  servicos: ServicoValidado[];
} {
  const erros: ErroDeValidacao[] = [];
  const servicos: ServicoValidado[] = [];

  for (const linha of linhas) {
    const prefixo = `servico-${linha.indice}`;
    const errosDaLinha: ErroDeValidacao[] = [];

    if (!linha.pessoaId) {
      errosDaLinha.push({ field: `${prefixo}-pessoaId`, message: "Selecione a pessoa do serviço." });
    }
    if (!linha.itemRevisionalId) {
      errosDaLinha.push({
        field: `${prefixo}-itemRevisionalId`,
        message: "Selecione o item trabalhado do serviço.",
      });
    }

    // O <select> sempre manda um dos dois valores; um request adulterado com
    // qualquer outro é recusado aqui e nunca chega ao Prisma (mesmo padrão de
    // `setor` em validarCamposGerais).
    if (!isModoValido(linha.modo)) {
      errosDaLinha.push({
        field: `${prefixo}-modo`,
        message: "Selecione um modo de lançamento válido.",
      });
      erros.push(...errosDaLinha);
      continue;
    }

    if (linha.modo === "Duracao") {
      const resultado = interpretarDuracao(linha.horas);
      if (resultado.tipo === "recusado") {
        errosDaLinha.push({
          field: `${prefixo}-horas`,
          message: MENSAGEM_POR_MOTIVO_HORAS[resultado.motivo],
        });
      } else if (errosDaLinha.length === 0) {
        servicos.push({
          pessoaId: linha.pessoaId,
          itemRevisionalId: linha.itemRevisionalId,
          modo: "Duracao",
          duracaoMinutos: resultado.minutos,
        });
      }

      erros.push(...errosDaLinha);
      continue;
    }

    // Modo `Periodo`: os dois marcos passam a ser OBRIGATÓRIOS (Design Notes —
    // é o que permite a CHECK do banco apertar nesta story). parseDataHora é
    // reusado, não reescrito.
    const inicio = parseDataHora(linha.inicio);
    const fim = parseDataHora(linha.fim);
    if (inicio === "invalido") {
      errosDaLinha.push({ field: `${prefixo}-inicio`, message: "Informe um início de serviço válido." });
    }
    if (fim === "invalido") {
      errosDaLinha.push({ field: `${prefixo}-fim`, message: "Informe um fim de serviço válido." });
    }
    if (inicio === null || fim === null) {
      // Período incompleto — o erro vai para `-fim` (I/O Matrix), o campo que
      // fecha o lançamento.
      errosDaLinha.push({
        field: `${prefixo}-fim`,
        message: "Informe o início e o fim do serviço.",
      });
    }

    if (inicio instanceof Date && fim instanceof Date) {
      const resultado = duracaoDoPeriodo(inicio, fim);
      if (resultado.tipo === "recusado") {
        errosDaLinha.push({
          field: `${prefixo}-fim`,
          message: MENSAGEM_POR_MOTIVO_PERIODO[resultado.motivo],
        });
      } else if (errosDaLinha.length === 0) {
        servicos.push({
          pessoaId: linha.pessoaId,
          itemRevisionalId: linha.itemRevisionalId,
          modo: "Periodo",
          inicio,
          fim,
        });
      }
    }

    erros.push(...errosDaLinha);
  }

  return { erros, servicos };
}
