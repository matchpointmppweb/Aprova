import { TETO_DE_MINUTOS, somarMinutos } from "./duracao";

// Organização da ORDEM DE SERVIÇO IMPRESSA (C2, 27-10-2026).
//
// Módulo PURO, sem Prisma e sem React: é o único lugar onde o agrupamento da
// OS pode ser testado, porque o projeto não tem render de componente em teste
// (mesma razão que fez `emissao-estado.ts` crescer). A página de impressão
// só traduz o que sai daqui em <table>.
//
// A OS sai PREENCHIDA — é comprovante do que foi executado, não formulário em
// branco para o mecânico anotar à mão. Decisão de Fulvi em 27-10-2026.
//
// O layout vem das imagens de OS de um TMS que Fulvi enviou como MODELO
// VISUAL. Dali se aproveitou a FORMA — seções por categoria e grupo na
// primeira coluna — e nada além disso. Os campos de veículo daquele
// relatório (placa, chassi, km, motorista) nunca entraram: não existem no
// modelo do Raiz. As três etapas de verificação chegaram a entrar, em
// 26-10-2026, e SAÍRAM no dia seguinte a pedido de Fulvi — eram convenção
// daquele outro sistema, não do fluxo dele. Não reintroduzir por conta
// própria: se voltarem, é porque ele pediu.

/// Rótulo das seções/células sem valor. A categoria e o grupo são opcionais
/// (texto livre), e um item sem eles precisa aparecer no papel — some-lo
/// seria perder item da emissão.
export const CATEGORIA_SEM_NOME = "Sem categoria";
export const GRUPO_SEM_NOME = "—";

export type ItemDaOS = {
  itemRevisionalId: string;
  nome: string;
  categoria: string | null;
  grupo: string | null;
  executado: boolean;
  observacao: string | null;
};

export type SecaoDaOS = {
  /// Já resolvido: nunca null, nunca "" — é o que vai no cabeçalho da seção.
  categoria: string;
  itens: ItemDaOS[];
};

function preenchido(valor: string | null): boolean {
  return valor !== null && valor.trim() !== "";
}

function rotuloDaCategoria(item: ItemDaOS): string {
  return preenchido(item.categoria) ? (item.categoria as string).trim() : CATEGORIA_SEM_NOME;
}

function compararTexto(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR");
}

/// Agrupa os itens da emissão nas seções da OS.
///
/// Ordem determinística em três níveis (sem ela, duas impressões da MESMA
/// emissão sairiam com as linhas em ordens diferentes, e a OS é documento):
///  1. seções por categoria, alfabética pt-BR, com "Sem categoria" SEMPRE no
///     fim — é o resto, e resto não abre documento;
///  2. dentro da seção, por grupo, com os sem grupo no fim pelo mesmo motivo;
///  3. por nome do item, que é único por conta e portanto desempata sempre.
export function secoesDaOS(itens: readonly ItemDaOS[]): SecaoDaOS[] {
  const porCategoria = new Map<string, ItemDaOS[]>();
  for (const item of itens) {
    const categoria = rotuloDaCategoria(item);
    const existentes = porCategoria.get(categoria);
    if (existentes) existentes.push(item);
    else porCategoria.set(categoria, [item]);
  }

  const categorias = [...porCategoria.keys()].sort((a, b) => {
    if (a === CATEGORIA_SEM_NOME) return 1;
    if (b === CATEGORIA_SEM_NOME) return -1;
    return compararTexto(a, b);
  });

  return categorias.map((categoria) => {
    const itensDaSecao = [...(porCategoria.get(categoria) as ItemDaOS[])].sort((a, b) => {
      const grupoA = preenchido(a.grupo) ? (a.grupo as string).trim() : null;
      const grupoB = preenchido(b.grupo) ? (b.grupo as string).trim() : null;
      if (grupoA !== grupoB) {
        if (grupoA === null) return 1;
        if (grupoB === null) return -1;
        const porGrupo = compararTexto(grupoA, grupoB);
        if (porGrupo !== 0) return porGrupo;
      }
      return compararTexto(a.nome, b.nome);
    });

    return { categoria, itens: itensDaSecao };
  });
}

/// Texto da célula de grupo — o grupo aparado, ou o travessão.
export function rotuloDoGrupo(grupo: string | null): string {
  return preenchido(grupo) ? (grupo as string).trim() : GRUPO_SEM_NOME;
}

// ---------------------------------------------------------------------------
// Apontamento de mão de obra
// ---------------------------------------------------------------------------
// As linhas da aba Serviço já estão GRAVADAS, com `Date` de verdade — então a
// duração sai direto de `duracaoMinutos` ou da subtração dos marcos, sem
// passar pelas strings de formulário que `minutosDaLinhaDeServico`
// (emissao-estado.ts) precisa interpretar. Aquela função serve à TELA, que só
// tem texto digitado; esta serve ao PAPEL, que lê o banco.
export type ServicoGravado = {
  modo: "Duracao" | "Periodo";
  duracaoMinutos: number | null;
  inicio: Date | null;
  fim: Date | null;
};

/// Minutos de uma linha gravada, ou `null` quando a linha não tem duração
/// apurável.
///
/// `null` NÃO é zero (NFR7): a linha legada da 5.5 — `Periodo` com os dois
/// marcos nulos, gravada antes da migration que apertou a CHECK — existe e o
/// usuário a vê, mas somá-la como zero faria o total do papel mentir. Ela
/// imprime travessão e fica fora da soma.
export function minutosDoServicoGravado(servico: ServicoGravado): number | null {
  if (servico.modo === "Duracao") {
    const minutos = servico.duracaoMinutos;
    if (minutos === null || !Number.isInteger(minutos) || minutos <= 0) return null;
    return minutos > TETO_DE_MINUTOS ? null : minutos;
  }

  if (!servico.inicio || !servico.fim) return null;
  const minutos = Math.round((servico.fim.getTime() - servico.inicio.getTime()) / 60_000);
  if (minutos <= 0 || minutos > TETO_DE_MINUTOS) return null;
  return minutos;
}

/// Total do apontamento — soma SÓ as linhas apuráveis, pela mesma
/// `somarMinutos` que o rodapé da aba Serviço usa (AD-29: total é derivado,
/// nunca coluna).
export function totalDeMinutosGravados(servicos: readonly ServicoGravado[]): number {
  const minutos: number[] = [];
  for (const servico of servicos) {
    const apurado = minutosDoServicoGravado(servico);
    if (apurado !== null) minutos.push(apurado);
  }
  return somarMinutos(minutos);
}
