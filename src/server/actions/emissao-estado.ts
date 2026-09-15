// Tipo e estado inicial compartilhados pelas Server Actions de Emissão —
// mesma convenção { ok, data?, error? } de plano-estado.ts/
// item-revisional-estado.ts (Consistency Conventions da arquitetura).
//
// Fica fora de actions/emissao.ts porque um módulo "use server" só pode
// exportar funções assíncronas — nenhuma constante ou tipo (mesmo motivo de
// plano-estado.ts).
import type { Setor } from "@prisma/client";

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
  inicio: string;
  fim: string;
};

export type ServicoValidado = {
  pessoaId: string;
  itemRevisionalId: string;
  inicio: Date | null;
  fim: Date | null;
};

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

// Valida as linhas da aba "Serviço" (Story 5.5). Zero linhas é um estado
// válido (Never: nunca exigir ao menos um serviço). Pessoa e item revisional
// são obrigatórios em cada linha existente; o vínculo cross-tenant de cada
// id é checado à parte pela Server Action, contra os dados reais da conta
// (AD-1), do mesmo jeito que ativo/plano/responsável.
export function validarServicos(linhas: LinhaServicoBruta[]): {
  erros: ErroDeValidacao[];
  servicos: ServicoValidado[];
} {
  const erros: ErroDeValidacao[] = [];
  const servicos: ServicoValidado[] = [];

  for (const linha of linhas) {
    const prefixo = `servico-${linha.indice}`;
    if (!linha.pessoaId) {
      erros.push({ field: `${prefixo}-pessoaId`, message: "Selecione a pessoa do serviço." });
    }
    if (!linha.itemRevisionalId) {
      erros.push({
        field: `${prefixo}-itemRevisionalId`,
        message: "Selecione o item trabalhado do serviço.",
      });
    }

    const inicio = parseDataHora(linha.inicio);
    const fim = parseDataHora(linha.fim);
    if (inicio === "invalido") {
      erros.push({ field: `${prefixo}-inicio`, message: "Informe um início de serviço válido." });
    }
    if (fim === "invalido") {
      erros.push({ field: `${prefixo}-fim`, message: "Informe um fim de serviço válido." });
    }

    // Ordem cronológica da linha: só checável com os dois marcos preenchidos
    // e válidos (ambos são opcionais, como na aba Geral).
    const foraDeOrdem =
      inicio instanceof Date && fim instanceof Date && fim.getTime() < inicio.getTime();
    if (foraDeOrdem) {
      erros.push({
        field: `${prefixo}-fim`,
        message: "O fim do serviço não pode ser anterior ao início.",
      });
    }

    if (
      linha.pessoaId &&
      linha.itemRevisionalId &&
      inicio !== "invalido" &&
      fim !== "invalido" &&
      !foraDeOrdem
    ) {
      servicos.push({
        pessoaId: linha.pessoaId,
        itemRevisionalId: linha.itemRevisionalId,
        inicio,
        fim,
      });
    }
  }

  return { erros, servicos };
}
