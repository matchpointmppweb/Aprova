import { formatarDia } from "./datas";
import { formatarMinutos, somarMinutos } from "./duracao";
import { minutosDoServicoGravado, type ServicoGravado } from "./ordem-de-servico";

// Catálogo e agregação dos RELATÓRIOS (C3, 27-10-2026).
//
// Módulo PURO, sem Prisma e sem React — mesma razão de `ordem-de-servico.ts`
// e `emissao-estado.ts`: é a única camada testável, porque o projeto não tem
// render de componente. As CONSULTAS vivem em
// `src/server/repositories/relatorio.ts`; aqui ficam o catálogo, a leitura
// dos filtros e a transformação do dado consultado em linhas de tabela.
//
// Faturamento NÃO entra: não existe nada dele no sistema nem no negócio hoje
// (Fulvi, 27-10-2026). Não inventar relatório sem dado por trás.

export const CATEGORIAS_DE_RELATORIO = [
  "servicos-por-pessoa",
  "emissoes-por-ativo",
  "itens-pendentes",
  "ativos-por-revisao",
  "pessoas",
] as const;

export type CategoriaDeRelatorio = (typeof CATEGORIAS_DE_RELATORIO)[number];

export type DefinicaoDeRelatorio = {
  titulo: string;
  descricao: string;
  /// Relatório de PERÍODO filtra por `dataEmissao`; os de FOTOGRAFIA mostram
  /// a situação de agora e não aceitam datas. Esconder os campos de data no
  /// segundo caso evita a pior armadilha de tela de relatório: filtro que
  /// parece aplicado e é ignorado em silêncio.
  usaPeriodo: boolean;
};

// `Record` da união, de propósito: acrescentar uma categoria à lista acima
// para de compilar até ganhar título e descrição aqui.
export const RELATORIOS: Record<CategoriaDeRelatorio, DefinicaoDeRelatorio> = {
  "servicos-por-pessoa": {
    titulo: "Serviços por pessoa",
    descricao: "Quanto cada pessoa trabalhou — lançamentos e horas somadas.",
    usaPeriodo: true,
  },
  "emissoes-por-ativo": {
    titulo: "Emissões por ativo",
    descricao: "Quantas emissões cada ativo teve, por situação, e as horas gastas.",
    usaPeriodo: true,
  },
  "itens-pendentes": {
    titulo: "Itens pendentes",
    descricao: "O que foi emitido e ainda não foi executado.",
    usaPeriodo: true,
  },
  "ativos-por-revisao": {
    titulo: "Ativos por situação de revisão",
    descricao: "Fotografia de agora: quando cada ativo foi revisado pela última vez.",
    usaPeriodo: false,
  },
  pessoas: {
    titulo: "Pessoas",
    descricao: "Fotografia de agora: o cadastro de pessoas com cargo e função.",
    usaPeriodo: false,
  },
};

export const CATEGORIA_PADRAO: CategoriaDeRelatorio = "servicos-por-pessoa";

export function isCategoriaDeRelatorio(valor: string): valor is CategoriaDeRelatorio {
  return (CATEGORIAS_DE_RELATORIO as readonly string[]).includes(valor);
}

// ---------------------------------------------------------------------------
// Período
// ---------------------------------------------------------------------------

export const ERRO_DATA_INVALIDA = "Informe as datas no formato dd/mm/aaaa.";
export const ERRO_PERIODO_INVERTIDO = "A data final não pode ser anterior à inicial.";

export type Periodo = { de: Date | null; ate: Date | null };

export type LeituraDePeriodo = { ok: true; periodo: Periodo } | { ok: false; erro: string };

// `<input type="date">` manda "YYYY-MM-DD". Interpretado em UTC, e não no
// fuso do processo, pelo mesmo motivo de `parseDataHora`
// (emissao-estado.ts): o servidor roda em UTC na Vercel e o cliente é UTC-3,
// e deixar a borda do dia ao fuso do processo faria o mesmo filtro devolver
// conjuntos diferentes em ambientes diferentes.
//
// Limite consciente: a borda é o dia em UTC, não o dia no relógio de quem
// olha. Um lançamento das 22h de 26/10 no horário de Brasília é 01h de 27/10
// em UTC e cai no dia seguinte do filtro. O produto é single-timezone pt-BR
// e isto é aceito aqui como é aceito no resto do projeto; precisa ser revisto
// junto com os demais pontos se algum dia atender múltiplos fusos.
function lerData(bruto: string, fimDoDia: boolean): Date | null | "invalido" {
  const valor = bruto.trim();
  if (!valor) return null;

  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!partes) return "invalido";

  const [, ano, mes, dia] = partes;
  const data = fimDoDia
    ? new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia), 23, 59, 59, 999))
    : new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
  if (Number.isNaN(data.getTime())) return "invalido";

  // Confirma que os componentes batem com a string: "2026-02-30", que
  // Date.UTC normalizaria em silêncio para 02/03, é recusado em vez de virar
  // outra data.
  const bate =
    data.getUTCFullYear() === Number(ano) &&
    data.getUTCMonth() + 1 === Number(mes) &&
    data.getUTCDate() === Number(dia);
  return bate ? data : "invalido";
}

/// Lê os dois campos de data do formulário.
///
/// A data final é INCLUSIVA — vai até 23:59:59.999 daquele dia. Sem isso,
/// "de 01/10 até 31/10" perderia tudo o que aconteceu em 31/10 depois da
/// meia-noite, que é quase tudo, e o relatório mentiria sem avisar.
///
/// Os dois lados são opcionais e independentes: só "de" é "a partir de", só
/// "até" é "antes de", nenhum é "tudo".
export function interpretarPeriodo(deBruto: string, ateBruto: string): LeituraDePeriodo {
  const de = lerData(deBruto, false);
  const ate = lerData(ateBruto, true);

  if (de === "invalido" || ate === "invalido") {
    return { ok: false, erro: ERRO_DATA_INVALIDA };
  }
  if (de && ate && ate.getTime() < de.getTime()) {
    return { ok: false, erro: ERRO_PERIODO_INVERTIDO };
  }
  return { ok: true, periodo: { de, ate } };
}

// ---------------------------------------------------------------------------
// Forma das tabelas
// ---------------------------------------------------------------------------
// Uma única forma para todos os relatórios: a página tem UM renderizador de
// tabela, e acrescentar relatório é acrescentar consulta + montagem, nunca
// JSX novo. Valores já chegam como TEXTO formatado — a formatação é decisão
// de quem monta a linha, que conhece a unidade; a tabela só desenha.

export type ColunaDoRelatorio = {
  chave: string;
  rotulo: string;
  /// Números alinham à direita para poderem ser comparados a olho na coluna.
  numerica?: boolean;
};

export type LinhaDoRelatorio = Record<string, string>;

export type TabelaDoRelatorio = {
  colunas: ColunaDoRelatorio[];
  linhas: LinhaDoRelatorio[];
  /// Linha de totais, quando somar faz sentido. Ausente quando não faz —
  /// somar coluna de texto ou de contagem de coisas diferentes é ruído.
  total?: LinhaDoRelatorio;
};

function compararTexto(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR");
}

// ---------------------------------------------------------------------------
// Serviços por pessoa
// ---------------------------------------------------------------------------

export type LancamentoDeServico = ServicoGravado & {
  pessoaId: string;
  pessoaNome: string;
  cargo: string;
};

export type ServicosDeUmaPessoa = {
  pessoaId: string;
  pessoaNome: string;
  cargo: string;
  lancamentos: number;
  minutos: number;
};

/// Agrupa os lançamentos por pessoa.
///
/// `lancamentos` conta TODAS as linhas da pessoa, inclusive as que não têm
/// duração apurável: elas existem e a pessoa as vê na emissão. Já `minutos`
/// soma só as apuráveis, pela mesma `minutosDoServicoGravado` da OS impressa
/// (AD-29) — contar uma linha e somar zero por ela são coisas diferentes, e
/// juntá-las faria a média por lançamento mentir.
export function agruparServicosPorPessoa(
  lancamentos: readonly LancamentoDeServico[],
): ServicosDeUmaPessoa[] {
  const porPessoa = new Map<string, ServicosDeUmaPessoa>();

  for (const lancamento of lancamentos) {
    let entrada = porPessoa.get(lancamento.pessoaId);
    if (!entrada) {
      entrada = {
        pessoaId: lancamento.pessoaId,
        pessoaNome: lancamento.pessoaNome,
        cargo: lancamento.cargo,
        lancamentos: 0,
        minutos: 0,
      };
      porPessoa.set(lancamento.pessoaId, entrada);
    }
    entrada.lancamentos += 1;
    const minutos = minutosDoServicoGravado(lancamento);
    if (minutos !== null) entrada.minutos += minutos;
  }

  // Mais horas primeiro — é a pergunta que o relatório responde. Nome
  // desempata, para duas pessoas com o mesmo total saírem sempre na mesma
  // ordem entre duas gerações do mesmo relatório.
  return [...porPessoa.values()].sort(
    (a, b) => b.minutos - a.minutos || compararTexto(a.pessoaNome, b.pessoaNome),
  );
}

// ---------------------------------------------------------------------------
// Emissões por ativo
// ---------------------------------------------------------------------------

export type EmissaoDoRelatorio = {
  ativoId: string;
  ativoCodigo: string;
  ativoNome: string;
  status: "Rascunho" | "EmAnalise" | "Emitido" | "Reprovado";
  servicos: readonly ServicoGravado[];
};

export type EmissoesDeUmAtivo = {
  ativoId: string;
  ativoCodigo: string;
  ativoNome: string;
  total: number;
  rascunho: number;
  emAnalise: number;
  emitido: number;
  reprovado: number;
  minutos: number;
};

export function agruparEmissoesPorAtivo(
  emissoes: readonly EmissaoDoRelatorio[],
): EmissoesDeUmAtivo[] {
  const porAtivo = new Map<string, EmissoesDeUmAtivo>();

  for (const emissao of emissoes) {
    let entrada = porAtivo.get(emissao.ativoId);
    if (!entrada) {
      entrada = {
        ativoId: emissao.ativoId,
        ativoCodigo: emissao.ativoCodigo,
        ativoNome: emissao.ativoNome,
        total: 0,
        rascunho: 0,
        emAnalise: 0,
        emitido: 0,
        reprovado: 0,
        minutos: 0,
      };
      porAtivo.set(emissao.ativoId, entrada);
    }
    entrada.total += 1;
    if (emissao.status === "Rascunho") entrada.rascunho += 1;
    if (emissao.status === "EmAnalise") entrada.emAnalise += 1;
    if (emissao.status === "Emitido") entrada.emitido += 1;
    if (emissao.status === "Reprovado") entrada.reprovado += 1;

    const minutos: number[] = [];
    for (const servico of emissao.servicos) {
      const apurado = minutosDoServicoGravado(servico);
      if (apurado !== null) minutos.push(apurado);
    }
    entrada.minutos += somarMinutos(minutos);
  }

  // Pelo CÓDIGO do ativo, não pelo nome: o código é único por conta e é como
  // a pessoa procura a linha no papel. Nome pode repetir.
  return [...porAtivo.values()].sort((a, b) => compararTexto(a.ativoCodigo, b.ativoCodigo));
}

// ---------------------------------------------------------------------------
// Montagem das tabelas
// ---------------------------------------------------------------------------
// Domínio -> linhas de texto. Fica aqui, e não na página, porque é onde
// mora a decisão de unidade e de rótulo — e porque dentro de um `.tsx` seria
// intestável. A página só traduz o retorno do Prisma para os tipos simples
// abaixo, tradução que o compilador confere.

const SEM_VALOR = "—";

function texto(valor: string | null | undefined): string {
  return valor !== null && valor !== undefined && valor.trim() !== "" ? valor : SEM_VALOR;
}

export const LABEL_POR_STATUS_EMISSAO: Record<EmissaoDoRelatorio["status"], string> = {
  Rascunho: "Rascunho",
  EmAnalise: "Em análise",
  Emitido: "Emitido",
  Reprovado: "Reprovado",
};

export function montarServicosPorPessoa(
  lancamentos: readonly LancamentoDeServico[],
): TabelaDoRelatorio {
  const agrupado = agruparServicosPorPessoa(lancamentos);

  return {
    colunas: [
      { chave: "pessoa", rotulo: "Pessoa" },
      { chave: "cargo", rotulo: "Cargo" },
      { chave: "lancamentos", rotulo: "Lançamentos", numerica: true },
      { chave: "horas", rotulo: "Horas", numerica: true },
    ],
    linhas: agrupado.map((pessoa) => ({
      pessoa: pessoa.pessoaNome,
      cargo: texto(pessoa.cargo),
      lancamentos: String(pessoa.lancamentos),
      horas: formatarMinutos(pessoa.minutos),
    })),
    total: {
      pessoa: `${agrupado.length} ${agrupado.length === 1 ? "pessoa" : "pessoas"}`,
      cargo: "",
      lancamentos: String(agrupado.reduce((soma, pessoa) => soma + pessoa.lancamentos, 0)),
      // Soma dos SUBTOTAIS já apurados, nunca uma segunda varredura dos
      // lançamentos: duas aritméticas para o mesmo número divergiriam no dia
      // em que uma das duas mudasse.
      horas: formatarMinutos(somarMinutos(agrupado.map((pessoa) => pessoa.minutos))),
    },
  };
}

export function montarEmissoesPorAtivo(
  emissoes: readonly EmissaoDoRelatorio[],
): TabelaDoRelatorio {
  const agrupado = agruparEmissoesPorAtivo(emissoes);

  return {
    colunas: [
      { chave: "ativo", rotulo: "Ativo" },
      { chave: "total", rotulo: "Emissões", numerica: true },
      { chave: "rascunho", rotulo: "Rascunho", numerica: true },
      { chave: "emAnalise", rotulo: "Em análise", numerica: true },
      { chave: "emitido", rotulo: "Emitido", numerica: true },
      { chave: "reprovado", rotulo: "Reprovado", numerica: true },
      { chave: "horas", rotulo: "Horas", numerica: true },
    ],
    linhas: agrupado.map((ativo) => ({
      ativo: `${ativo.ativoCodigo} — ${ativo.ativoNome}`,
      total: String(ativo.total),
      rascunho: String(ativo.rascunho),
      emAnalise: String(ativo.emAnalise),
      emitido: String(ativo.emitido),
      reprovado: String(ativo.reprovado),
      horas: formatarMinutos(ativo.minutos),
    })),
    total: {
      ativo: `${agrupado.length} ${agrupado.length === 1 ? "ativo" : "ativos"}`,
      total: String(agrupado.reduce((soma, ativo) => soma + ativo.total, 0)),
      rascunho: String(agrupado.reduce((soma, ativo) => soma + ativo.rascunho, 0)),
      emAnalise: String(agrupado.reduce((soma, ativo) => soma + ativo.emAnalise, 0)),
      emitido: String(agrupado.reduce((soma, ativo) => soma + ativo.emitido, 0)),
      reprovado: String(agrupado.reduce((soma, ativo) => soma + ativo.reprovado, 0)),
      horas: formatarMinutos(somarMinutos(agrupado.map((ativo) => ativo.minutos))),
    },
  };
}

export type ItemPendente = {
  emissaoCodigo: string;
  emissaoStatus: EmissaoDoRelatorio["status"];
  dataEmissao: Date;
  ativoCodigo: string;
  ativoNome: string;
  item: string;
  categoria: string | null;
  observacao: string | null;
};

export function montarItensPendentes(itens: readonly ItemPendente[]): TabelaDoRelatorio {
  return {
    colunas: [
      { chave: "emissao", rotulo: "Emissão" },
      { chave: "data", rotulo: "Data" },
      { chave: "situacao", rotulo: "Situação" },
      { chave: "ativo", rotulo: "Ativo" },
      { chave: "categoria", rotulo: "Categoria" },
      { chave: "item", rotulo: "Item" },
      { chave: "observacao", rotulo: "Observação" },
    ],
    // Sem linha de total: a contagem já está no rodapé da tabela, e somar
    // qualquer uma destas colunas não responderia pergunta nenhuma.
    linhas: itens.map((pendente) => ({
      emissao: pendente.emissaoCodigo,
      data: formatarDia(pendente.dataEmissao),
      situacao: LABEL_POR_STATUS_EMISSAO[pendente.emissaoStatus],
      ativo: `${pendente.ativoCodigo} — ${pendente.ativoNome}`,
      categoria: texto(pendente.categoria),
      item: pendente.item,
      observacao: texto(pendente.observacao),
    })),
  };
}

export type AtivoPorRevisao = {
  codigo: string;
  nome: string;
  tipo: string;
  empresa: string | null;
  localizacao: string;
  status: string;
  totalDeEmissoes: number;
  ultimaEmissao: { codigo: string; dataEmissao: Date } | null;
};

export function montarAtivosPorRevisao(ativos: readonly AtivoPorRevisao[]): TabelaDoRelatorio {
  return {
    colunas: [
      { chave: "ativo", rotulo: "Ativo" },
      { chave: "tipo", rotulo: "Tipo" },
      { chave: "empresa", rotulo: "Empresa" },
      { chave: "localizacao", rotulo: "Localização" },
      { chave: "status", rotulo: "Status" },
      { chave: "emissoes", rotulo: "Emissões", numerica: true },
      { chave: "ultima", rotulo: "Última revisão" },
    ],
    linhas: ativos.map((ativo) => ({
      ativo: `${ativo.codigo} — ${ativo.nome}`,
      tipo: ativo.tipo,
      empresa: texto(ativo.empresa),
      localizacao: ativo.localizacao,
      status: ativo.status,
      emissoes: String(ativo.totalDeEmissoes),
      // "Nunca revisado" em vez de travessão: aqui a ausência é a RESPOSTA
      // que o relatório procura, não um campo que ninguém preencheu.
      ultima: ativo.ultimaEmissao
        ? `${formatarDia(ativo.ultimaEmissao.dataEmissao)} (${ativo.ultimaEmissao.codigo})`
        : "Nunca revisado",
    })),
  };
}

export type PessoaDoRelatorio = {
  nome: string;
  cpf: string;
  cargo: string;
  funcao: string;
  lancamentos: number;
};

export function montarPessoas(pessoas: readonly PessoaDoRelatorio[]): TabelaDoRelatorio {
  return {
    colunas: [
      { chave: "nome", rotulo: "Pessoa" },
      { chave: "cpf", rotulo: "CPF" },
      { chave: "cargo", rotulo: "Cargo" },
      { chave: "funcao", rotulo: "Função" },
      { chave: "lancamentos", rotulo: "Lançamentos", numerica: true },
    ],
    linhas: pessoas.map((pessoa) => ({
      nome: pessoa.nome,
      cpf: pessoa.cpf,
      cargo: texto(pessoa.cargo),
      funcao: texto(pessoa.funcao),
      lancamentos: String(pessoa.lancamentos),
    })),
  };
}
