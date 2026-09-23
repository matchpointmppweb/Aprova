"use server";

import type { StatusEmissao } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { listarAtivos } from "@/src/server/repositories/ativo";
import {
  atualizarEmissao,
  atualizarStatusEmissao,
  buscarEmissao,
  criarEmissao,
  isViolacaoDeServicoIncoerente,
  type DadosEditarEmissao,
  type DadosItemExecutadoExistente,
  type DadosItemExecutadoNovo,
} from "@/src/server/repositories/emissao";
import { listarItensRevisionais } from "@/src/server/repositories/item-revisional";
import { listarPessoas } from "@/src/server/repositories/pessoa";
import { planosCandidatosDoAtivo } from "@/src/server/repositories/plano";
import { listarUsuarios } from "@/src/server/repositories/usuario";
import {
  calcularValorEsperado,
  derivarPlanoDoAtivo,
  emissaoTemProgresso,
  ERRO_CONFLITO_EDICAO,
  ERRO_SEM_PLANO_PARA_O_ATIVO,
  ERRO_TRANSICAO_INVALIDA,
  ERRO_TROCA_DE_PLANO_COM_PROGRESSO,
  erroDePlanoAmbiguo,
  isSetorValido,
  lerServicos,
  parseDataHora,
  SETOR_PADRAO,
  validarCamposGerais,
  validarServicos,
  type ErroDeValidacao,
  type EstadoAcaoEmissao,
  type ItemDoPlanoVigente,
  type ItemRevisionalReal,
  type LinhaServicoBruta,
} from "./emissao-estado";

const ERRO_SEM_PERMISSAO = "Você não tem permissão para realizar esta ação.";
// Nunca expõe detalhe de constraint/banco (Boundaries) — inclusive uma
// eventual colisão de código sob concorrência que tenha esgotado as
// tentativas de retry (I/O Matrix: "falha genérica após esgotar").
const ERRO_GENERICO = "Não foi possível concluir a operação. Tente novamente.";

// Story 7.3 — a CHECK do banco recusou uma linha de serviço que a validação
// deixou passar (os dois lados divergiram). Vira erro de CAMPO da aba Serviço,
// nunca um erro cru do Prisma nem um 500 (I/O Matrix: "Violação da CHECK"). O
// `field` começa com "servico" de propósito: é o que traz o modal para a aba
// certa (modal-emissao.tsx).
const ERRO_SERVICO_INCOERENTE: ErroDeValidacao = {
  field: "servico-lancamentos",
  message: "Revise as horas lançadas na aba Serviço — um dos lançamentos é inválido.",
};

// Campo numérico opcional (usado só para os campos de medição
// itemMedicaoDias/Km/Horas): string vazia/ausente -> null; valor inválido
// (NaN/decimal) também vira null. Mesmo padrão de lerCampoNumerico em
// actions/plano.ts — um input `disabled` (item não marcado como executado)
// nunca é enviado pelo browser, então cai neste mesmo caminho de null.
// Negativo também vira null: o `min={0}` do input é só client-side (Boundaries
// nunca confia em validação do cliente), e 0 é uma medição válida (ex.: item
// recém-trocado lido em 0km), só valor abaixo de zero não faz sentido para
// nenhum dos três controles.
function lerCampoNumerico(formData: FormData, nome: string): number | null {
  const bruto = String(formData.get(nome) ?? "").trim();
  if (!bruto) return null;
  const valor = Number(bruto);
  return Number.isFinite(valor) && Number.isInteger(valor) && valor >= 0 ? valor : null;
}

// Story 7.5 (AD-33) — `dataEmissao` NÃO é lida do FormData. A data é o instante
// em que o servidor cria a emissão, atribuído no repositório; um `dataEmissao`
// adulterado no FormData é simplesmente IGNORADO, nunca validado e nunca
// gravado (I/O Matrix: "Data forjada"). Por isso o antigo `parseDataEmissao`
// desapareceu em vez de continuar aqui sem chamador.
//
// `planoId` também deixou de ser um campo do formulário (AD-32): quando chega,
// vale só como ESCOLHA DE DESEMPATE numa ambiguidade, e é revalidada contra os
// candidatos reais em `derivarPlanoDaEmissao` — nunca aceita como o plano.
function lerCamposGerais(formData: FormData) {
  const ativoId = String(formData.get("ativoId") ?? "").trim();
  const planoEscolhidoId = String(formData.get("planoId") ?? "").trim();
  const responsavelId = String(formData.get("responsavelId") ?? "").trim();
  // Story 5.5: setor (validado contra o enum em validarCamposGerais) + os
  // três marcos opcionais de data/hora, cada um podendo vir como null
  // (campo vazio) ou "invalido" (valor malformado -> erro de campo).
  const setor = String(formData.get("setor") ?? "").trim();
  const dataAgendamento = parseDataHora(String(formData.get("dataAgendamento") ?? ""));
  const dataInicio = parseDataHora(String(formData.get("dataInicio") ?? ""));
  const dataFim = parseDataHora(String(formData.get("dataFim") ?? ""));
  return {
    ativoId,
    planoEscolhidoId,
    responsavelId,
    setor,
    dataAgendamento,
    dataInicio,
    dataFim,
  };
}

// A AUTORIDADE sobre o plano (AD-32): o servidor re-deriva sempre, com a MESMA
// `derivarPlanoDoAtivo` que a tela usa para pré-visualizar o checklist — e
// nunca confia no `planoId` do cliente, exceto como desempate de ambiguidade,
// revalidado contra os candidatos reais.
//
// Mesmo padrão do `valorEsperado`: a tela mostra, o servidor recalcula e grava.
async function derivarPlanoDaEmissao(
  contaId: string,
  ativoId: string,
  planoEscolhidoId: string,
): Promise<
  | { ok: true; plano: { id: string; itens: ItemDoPlanoVigente[] } }
  | { ok: false; erros: ErroDeValidacao[] }
> {
  const candidatos = await planosCandidatosDoAtivo(contaId, ativoId);
  if (!candidatos) {
    // Ativo inexistente ou de outra conta (AD-1) — nunca revela qual dos dois.
    return { ok: false, erros: [{ field: "ativoId", message: "Selecione um ativo válido." }] };
  }

  const derivacao = derivarPlanoDoAtivo(candidatos.ativo, candidatos.planos);
  if (derivacao.tipo === "ok") {
    return { ok: true, plano: derivacao.plano };
  }
  if (derivacao.tipo === "sem-plano") {
    // Recusa dizendo o que falta, sem gravar nada (Boundaries).
    return { ok: false, erros: [{ field: "planoId", message: ERRO_SEM_PLANO_PARA_O_ATIVO }] };
  }

  // Ambíguo: a escolha humana é aceita SÓ se for um dos candidatos reais. Um
  // `planoId` forjado (de outro ativo, de outra conta, arquivado) não está
  // entre eles e cai na mesma recusa de quem não escolheu — o servidor nunca
  // vincula a emissão a um plano de fora (I/O Matrix: "Escolha forjada").
  const escolhido = derivacao.candidatos.find((plano) => plano.id === planoEscolhidoId);
  if (escolhido) {
    return { ok: true, plano: escolhido };
  }
  return {
    ok: false,
    erros: [{ field: "planoId", message: erroDePlanoAmbiguo(derivacao.candidatos) }],
  };
}

// Estreita os campos da Story 5.5 já validados para a forma que o
// repositório espera — validarCamposGerais já rejeitou setor fora do enum e
// qualquer "invalido" nas três datas, então nem o fallback de setor nem o de
// data jamais ocorrem aqui (existem só para estreitar o tipo sem cast, nunca
// gravam dado errado).
function camposDeSetorEDatas(campos: ReturnType<typeof lerCamposGerais>) {
  const semInvalido = (valor: Date | null | "invalido") => (valor === "invalido" ? null : valor);
  return {
    setor: isSetorValido(campos.setor) ? campos.setor : SETOR_PADRAO,
    dataAgendamento: semInvalido(campos.dataAgendamento),
    dataInicio: semInvalido(campos.dataInicio),
    dataFim: semInvalido(campos.dataFim),
  };
}

// emissaoId + updatedAt são os únicos campos comuns a toda ação que opera
// sobre uma emissão JÁ EXISTENTE (Code Map) — editarEmissaoAction e as 4
// transições de status de Story 4.2 leem/validam exatamente o mesmo par de
// campos ocultos, então vivem numa única função em vez de duplicadas em
// cada Server Action.
function lerIdentificacaoEmissao(formData: FormData) {
  const emissaoId = String(formData.get("emissaoId") ?? "").trim();
  const updatedAtBruto = String(formData.get("updatedAt") ?? "").trim();

  const erros: ErroDeValidacao[] = [];
  if (!emissaoId) erros.push({ field: "emissaoId", message: "Emissão inválida." });

  const updatedAtEsperado = updatedAtBruto ? new Date(updatedAtBruto) : null;
  if (!updatedAtEsperado || Number.isNaN(updatedAtEsperado.getTime())) {
    erros.push({ field: "updatedAt", message: "Emissão inválida." });
  }

  return { emissaoId, updatedAtEsperado, erros };
}

// O <select> de ativo/plano/responsável no formulário já só lista opções da
// própria conta, mas a Server Action é o guard real (AD-1) — nunca confia
// num id vindo do cliente sem checar contra os dados reais da conta (I/O
// Matrix: "Ativo/Plano de outra conta" -> erro de validação de campo). Mesmo
// padrão de vinculoEResponsavelValidos em actions/plano.ts.
// Story 5.5: valida também cada linha de serviço — `pessoaId` contra
// listarPessoas(contaId) e `itemRevisionalId` contra o mesmo Map de itens
// reais da conta já usado para montar o snapshot dos itens executados. Um id
// de outra conta é rejeitado como erro de campo ANTES de qualquer escrita —
// nada é persistido (nem emissão, nem itens, nem serviços), e a mensagem
// nunca revela se o registro existe em outra conta (I/O Matrix).
//
// Story 7.5: o PLANO saiu daqui — ele não vem mais do cliente, então não há id
// de plano a conferir contra a conta; quem responde por ele é
// `derivarPlanoDaEmissao`, que só enxerga os candidatos reais do ativo.
async function referenciasValidas(
  contaId: string,
  campos: { ativoId: string; responsavelId: string },
  servicos: LinhaServicoBruta[],
) {
  const [ativos, usuarios, itensReaisPorId, pessoas] = await Promise.all([
    listarAtivos(contaId),
    listarUsuarios(contaId),
    buscarItensReaisPorId(contaId),
    servicos.length > 0 ? listarPessoas(contaId) : Promise.resolve([]),
  ]);

  const erros: { field: string; message: string }[] = [];
  if (campos.ativoId && !ativos.some((ativo) => ativo.id === campos.ativoId)) {
    erros.push({ field: "ativoId", message: "Selecione um ativo válido." });
  }
  if (campos.responsavelId && !usuarios.some((usuario) => usuario.id === campos.responsavelId)) {
    erros.push({ field: "responsavelId", message: "Selecione um responsável válido." });
  }

  const pessoasDaConta = new Set(pessoas.map((pessoa) => pessoa.id));
  for (const linha of servicos) {
    if (linha.pessoaId && !pessoasDaConta.has(linha.pessoaId)) {
      erros.push({
        field: `servico-${linha.indice}-pessoaId`,
        message: "Selecione uma pessoa válida.",
      });
    }
    if (linha.itemRevisionalId && !itensReaisPorId.has(linha.itemRevisionalId)) {
      erros.push({
        field: `servico-${linha.indice}-itemRevisionalId`,
        message: "Selecione um item trabalhado válido.",
      });
    }
  }

  return { erros, itensReaisPorId };
}

async function buscarItensReaisPorId(contaId: string) {
  const itens = await listarItensRevisionais(contaId);
  const mapa = new Map<string, ItemRevisionalReal>();
  for (const item of itens) {
    mapa.set(item.id, {
      id: item.id,
      nome: item.nome,
      diasPadrao: item.diasPadrao,
      kmPadrao: item.kmPadrao,
      horasPadrao: item.horasPadrao,
    });
  }
  return mapa;
}

// Monta o snapshot de itens executados a partir dos itens ATUAIS do plano
// (Intent: "lista de itens executados espelhando os itens do plano no
// momento da criação") — uma linha por item do plano, nunca um subconjunto
// escolhido no cliente (checklist fixo, Code Map). Usado na criação e na
// troca de plano da edição (Boundaries).
function montarItensNovos(
  itensDoPlano: { itemRevisionalId: string; diasOverride: number | null; kmOverride: number | null; horasOverride: number | null }[],
  itensReaisPorId: Map<string, ItemRevisionalReal>,
  formData: FormData,
): DadosItemExecutadoNovo[] {
  return itensDoPlano.map((itemDoPlano) => {
    const id = itemDoPlano.itemRevisionalId;
    const itemReal = itensReaisPorId.get(id);
    const valorEsperado = calcularValorEsperado(itemDoPlano, itemReal);
    return {
      itemRevisionalId: id,
      executado: Boolean(formData.get(`itemExecutado-${id}`)),
      ...valorEsperado,
      medicaoDias: lerCampoNumerico(formData, `itemMedicaoDias-${id}`),
      medicaoKm: lerCampoNumerico(formData, `itemMedicaoKm-${id}`),
      medicaoHoras: lerCampoNumerico(formData, `itemMedicaoHoras-${id}`),
      observacao: String(formData.get(`itemObs-${id}`) ?? "").trim() || null,
    };
  });
}

// Atualiza as linhas EXISTENTES da emissão (Boundaries: edição sem trocar o
// plano nunca é delete+recreate) — itera sobre os itens já persistidos da
// própria emissão (nunca sobre o plano, que pode ter mudado de itens desde a
// criação), preservando o progresso já registrado. valorEsperado* nunca é
// lido/reenviado aqui — é o snapshot imutável, o repositório nunca o toca
// neste fluxo.
function montarItensExistentes(
  itensDaEmissao: { itemRevisionalId: string }[],
  formData: FormData,
): DadosItemExecutadoExistente[] {
  return itensDaEmissao.map((item) => {
    const id = item.itemRevisionalId;
    return {
      itemRevisionalId: id,
      executado: Boolean(formData.get(`itemExecutado-${id}`)),
      medicaoDias: lerCampoNumerico(formData, `itemMedicaoDias-${id}`),
      medicaoKm: lerCampoNumerico(formData, `itemMedicaoKm-${id}`),
      medicaoHoras: lerCampoNumerico(formData, `itemMedicaoHoras-${id}`),
      observacao: String(formData.get(`itemObs-${id}`) ?? "").trim() || null,
    };
  });
}

// Given usuário autenticado com can(criar,'emissao') e ativo/plano/
// responsável/data válidos da própria conta, when cria uma emissão -> ela
// nasce em Rascunho com código "EM-{ano}-{seq}" único (retry-on-P2002 em
// criarEmissao) e os itens executados espelham os itens atuais do plano
// escolhido, cada um com snapshot do valor esperado, gravados numa única
// transação junto com a emissão (AD-9, I/O Matrix).
export async function criarEmissaoAction(
  _estadoAnterior: EstadoAcaoEmissao,
  formData: FormData,
): Promise<EstadoAcaoEmissao> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // AD-2: can() chamado no servidor antes de qualquer efeito, gate próprio
  // de 'criar' — nunca reaproveita o resultado de 'editar'.
  const autorizado = await can(usuarioSessao, "criar", "emissao");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const campos = lerCamposGerais(formData);
  const leituraDeServicos = lerServicos(formData);
  if (!leituraDeServicos.ok) {
    return { ok: false, error: leituraDeServicos.erro };
  }
  const linhasDeServico = leituraDeServicos.linhas;
  const { erros: errosDeServico, servicos } = validarServicos(linhasDeServico);
  const erros = [...validarCamposGerais(campos), ...errosDeServico];
  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  const { erros: errosDeReferencia, itensReaisPorId } = await referenciasValidas(
    usuarioSessao.contaId,
    campos,
    linhasDeServico,
  );
  if (errosDeReferencia.length > 0) {
    return { ok: false, error: errosDeReferencia };
  }

  // O plano é DERIVADO do ativo aqui, no servidor (AD-32) — nada é gravado
  // quando a derivação recusa (ambiguidade sem escolha, ou nenhum plano).
  const derivacao = await derivarPlanoDaEmissao(
    usuarioSessao.contaId,
    campos.ativoId,
    campos.planoEscolhidoId,
  );
  if (!derivacao.ok) {
    return { ok: false, error: derivacao.erros };
  }
  const planoAtual = derivacao.plano;

  const itens = montarItensNovos(planoAtual.itens, itensReaisPorId, formData);

  try {
    // Sem `dataEmissao` (AD-33): o repositório a atribui do relógio do
    // servidor, e é dela que sai o ano do código.
    await criarEmissao(usuarioSessao.contaId, {
      ativoId: campos.ativoId,
      planoId: planoAtual.id,
      responsavelId: campos.responsavelId,
      ...camposDeSetorEDatas(campos),
      servicos,
      itens,
    });
  } catch (erro) {
    if (isViolacaoDeServicoIncoerente(erro)) {
      return { ok: false, error: [ERRO_SERVICO_INCOERENTE] };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/emissao");
  return { ok: true };
}

// Given usuário autenticado com can(editar,'emissao') e `updatedAt` que bate
// com o valor atual da emissão, when edita ativo/plano/responsável/data/
// itens -> se o plano vinculado NÃO mudou, as linhas de item existentes são
// atualizadas in-place por itemRevisionalId (progresso preservado); se
// mudou, as linhas antigas são descartadas e um novo snapshot é gerado a
// partir dos itens atuais do novo plano (Boundaries, I/O Matrix). Se
// `updatedAt` enviado não bater (edição concorrente no meio), nada muda e
// retorna o erro de conflito de lock otimista (AD-9). Um id de emissão de
// outra conta nunca é encontrado (transação escopada por {id,contaId},
// AD-1).
export async function editarEmissaoAction(
  _estadoAnterior: EstadoAcaoEmissao,
  formData: FormData,
): Promise<EstadoAcaoEmissao> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const autorizado = await can(usuarioSessao, "editar", "emissao");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const campos = lerCamposGerais(formData);
  const leituraDeServicos = lerServicos(formData);
  if (!leituraDeServicos.ok) {
    return { ok: false, error: leituraDeServicos.erro };
  }
  const linhasDeServico = leituraDeServicos.linhas;
  const { erros: errosDeServico, servicos } = validarServicos(linhasDeServico);
  const {
    emissaoId,
    updatedAtEsperado,
    erros: errosDeIdentificacao,
  } = lerIdentificacaoEmissao(formData);
  const erros = [...validarCamposGerais(campos), ...errosDeServico, ...errosDeIdentificacao];

  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  const emissaoAtual = await buscarEmissao(usuarioSessao.contaId, emissaoId);
  if (!emissaoAtual) {
    // Emissão não encontrada nesta conta (AD-1) — nunca expõe detalhe.
    return { ok: false, error: ERRO_GENERICO };
  }

  // Story 4.2: correção de itens/campos gerais só é permitida com a emissão
  // em Rascunho (antes de enviar para análise) ou Reprovado (correção
  // pós-reprovação, antes de reenviar) — os 2 únicos estados editáveis do
  // fluxo de aprovação. Sem este guard, uma emissão EmAnalise ou já Emitida
  // continuaria livremente editável por baixo do workflow de status
  // introduzido por esta story.
  if (emissaoAtual.status !== "Rascunho" && emissaoAtual.status !== "Reprovado") {
    return { ok: false, error: ERRO_TRANSICAO_INVALIDA };
  }

  const { erros: errosDeReferencia, itensReaisPorId } = await referenciasValidas(
    usuarioSessao.contaId,
    campos,
    linhasDeServico,
  );
  if (errosDeReferencia.length > 0) {
    return { ok: false, error: errosDeReferencia };
  }

  // Re-deriva SOMENTE quando o ativo realmente mudou (AD-32) — trocar o ativo
  // pode trocar o plano. Com o MESMO ativo, o plano gravado é preservado sem
  // passar pela derivação: arquivar o plano depois da criação (ou surgir um
  // segundo plano cobrindo o mesmo ativo) deixaria a derivação sem resposta e
  // tornaria a emissão permanentemente ineditável — contra a I/O Matrix
  // ("Edição sem troca: mesmo ativo, com progresso → salva normalmente").
  const trocouAtivo = campos.ativoId !== emissaoAtual.ativoId;

  let planoNovo: Awaited<ReturnType<typeof derivarPlanoDaEmissao>> | null = null;
  if (trocouAtivo) {
    planoNovo = await derivarPlanoDaEmissao(
      usuarioSessao.contaId,
      campos.ativoId,
      campos.planoEscolhidoId,
    );
    if (!planoNovo.ok) {
      return { ok: false, error: planoNovo.erros };
    }
  }
  const planoDerivado = planoNovo?.ok ? planoNovo.plano : null;
  const planoIdAtual = planoDerivado?.id ?? emissaoAtual.planoId;

  const trocouPlano = planoIdAtual !== emissaoAtual.planoId;

  // O plano mudaria e a emissão JÁ TEM progresso GRAVADO: recusa com mensagem,
  // nunca apaga em silêncio (Boundaries/Design Notes). O ramo `trocouPlano` do
  // repositório faz deleteMany+createMany dos itens — sem este guard, trocar o
  // ativo levaria embora execução, medição, observação e o vínculo dos
  // lançamentos de uma emissão em produção. A avaliação é sobre `emissaoAtual`
  // (o que está no banco), nunca sobre o formulário.
  if (trocouPlano && emissaoTemProgresso(emissaoAtual)) {
    return {
      ok: false,
      error: [{ field: "ativoId", message: ERRO_TROCA_DE_PLANO_COM_PROGRESSO }],
    };
  }

  // Sem `dataEmissao` (AD-33): a edição nunca toca a data, o código, o ano nem
  // o sequencial já gravados.
  const comuns = {
    ativoId: campos.ativoId,
    planoId: planoIdAtual,
    responsavelId: campos.responsavelId,
    ...camposDeSetorEDatas(campos),
    servicos,
  };

  let dados: DadosEditarEmissao;
  if (trocouPlano && planoDerivado) {
    dados = {
      trocouPlano: true,
      ...comuns,
      itens: montarItensNovos(planoDerivado.itens, itensReaisPorId, formData),
    };
  } else {
    dados = {
      trocouPlano: false,
      ...comuns,
      itens: montarItensExistentes(emissaoAtual.itens, formData),
    };
  }

  try {
    const resultado = await atualizarEmissao(
      usuarioSessao.contaId,
      emissaoId,
      updatedAtEsperado as Date,
      dados,
    );

    if (!resultado.ok) {
      if (resultado.motivo === "conflito") {
        return { ok: false, error: ERRO_CONFLITO_EDICAO };
      }
      if (resultado.motivo === "servico-incoerente") {
        return { ok: false, error: [ERRO_SERVICO_INCOERENTE] };
      }
      // Emissão não encontrada nesta conta (AD-1) — nunca expõe detalhe.
      return { ok: false, error: ERRO_GENERICO };
    }
  } catch (erro) {
    if (isViolacaoDeServicoIncoerente(erro)) {
      return { ok: false, error: [ERRO_SERVICO_INCOERENTE] };
    }
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/emissao");
  return { ok: true };
}

// Miolo comum às 4 transições pontuais de status (Story 4.2) — cada action
// exportada abaixo só fixa a origem/destino esperados (e, na reprovação,
// exige o motivo). Não é o "único Server Action dispatcher" vetado pelo
// Boundaries: o cliente nunca escolhe a transição por parâmetro, cada botão
// da UI chama uma das 4 funções exportadas, que aqui só compartilham a
// sequência idêntica exigirUsuarioAutenticado -> can(editar,'emissao') ->
// ler emissaoId/updatedAt(+motivo) -> atualizarStatusEmissao -> mapear
// motivo de falha (Code Map).
async function executarTransicaoStatus(
  formData: FormData,
  statusOrigemEsperado: StatusEmissao,
  novoStatus: StatusEmissao,
  opcoes?: { exigirMotivo?: boolean },
): Promise<EstadoAcaoEmissao> {
  const usuarioSessao = await exigirUsuarioAutenticado();

  // A matriz de perfis não distingue 'aprovar'/'reprovar'/'enviar'/
  // 'reenviar' de 'editar' (Boundaries) — mesmo gate único de
  // editarEmissaoAction, chamado antes de qualquer leitura de campo (AD-2).
  const autorizado = await can(usuarioSessao, "editar", "emissao");
  if (!autorizado) {
    return { ok: false, error: ERRO_SEM_PERMISSAO };
  }

  const { emissaoId, updatedAtEsperado, erros } = lerIdentificacaoEmissao(formData);

  let motivo: string | undefined;
  if (opcoes?.exigirMotivo) {
    motivo = String(formData.get("motivo") ?? "").trim();
    if (!motivo) {
      erros.push({ field: "motivo", message: "Informe o motivo da reprovação." });
    }
  }

  if (erros.length > 0) {
    return { ok: false, error: erros };
  }

  try {
    const resultado = await atualizarStatusEmissao(
      usuarioSessao.contaId,
      emissaoId,
      updatedAtEsperado as Date,
      statusOrigemEsperado,
      novoStatus,
      motivo,
    );

    if (!resultado.ok) {
      if (resultado.motivo === "conflito") {
        return { ok: false, error: ERRO_CONFLITO_EDICAO };
      }
      if (resultado.motivo === "status-invalido") {
        return { ok: false, error: ERRO_TRANSICAO_INVALIDA };
      }
      // Emissão não encontrada nesta conta (AD-1) — nunca expõe detalhe.
      return { ok: false, error: ERRO_GENERICO };
    }
  } catch {
    return { ok: false, error: ERRO_GENERICO };
  }

  revalidatePath("/emissao");
  return { ok: true };
}

// Given emissão em Rascunho e can(editar,'emissao'), when enviada para
// análise -> status vira EmAnalise. Origem fixa (Rascunho): tentar enviar
// uma emissão que já não está mais em Rascunho cai em "status-invalido"
// (ERRO_TRANSICAO_INVALIDA), nada muda (I/O Matrix).
export async function enviarParaAnaliseAction(
  _estadoAnterior: EstadoAcaoEmissao,
  formData: FormData,
): Promise<EstadoAcaoEmissao> {
  return executarTransicaoStatus(formData, "Rascunho", "EmAnalise");
}

// Given emissão em EmAnalise e can(editar,'emissao'), when aprovada ->
// status vira Emitido (I/O Matrix).
export async function aprovarEmissaoAction(
  _estadoAnterior: EstadoAcaoEmissao,
  formData: FormData,
): Promise<EstadoAcaoEmissao> {
  return executarTransicaoStatus(formData, "EmAnalise", "Emitido");
}

// Given emissão em EmAnalise, motivo não-vazio e can(editar,'emissao'), when
// reprovada -> status vira Reprovado e motivoReprovacao é gravado (I/O
// Matrix). Motivo vazio -> erro de validação de campo antes de qualquer
// leitura no banco, nada muda.
export async function reprovarEmissaoAction(
  _estadoAnterior: EstadoAcaoEmissao,
  formData: FormData,
): Promise<EstadoAcaoEmissao> {
  return executarTransicaoStatus(formData, "EmAnalise", "Reprovado", { exigirMotivo: true });
}

// Given emissão Reprovada e can(editar,'emissao'), when reenviada -> status
// volta a EmAnalise na MESMA emissão; `motivoReprovacao` nunca é limpo aqui
// (atualizarStatusEmissao só grava o campo quando `motivoReprovacao` é
// passado, e esta transição nunca passa — Boundaries/CAP-5: o histórico da
// reprovação anterior fica visível até uma reprovação futura o sobrescrever).
export async function reenviarEmissaoAction(
  _estadoAnterior: EstadoAcaoEmissao,
  formData: FormData,
): Promise<EstadoAcaoEmissao> {
  return executarTransicaoStatus(formData, "Reprovado", "EmAnalise");
}
