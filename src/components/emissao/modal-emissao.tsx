"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { StatusBadge } from "@/src/components/shared/status-badge";
// Story 7.3 — `src/lib/duracao.ts` é a ÚNICA aritmética dos dois lados
// (Boundaries): o cliente interpreta, formata e soma com as mesmas funções que
// a Server Action usa para validar e gravar. Nenhum parse próprio, nenhum
// `padStart`, nenhum teto reescrito aqui.
import { DURACAO_INVALIDA, formatarMinutos } from "@/src/lib/duracao";
import {
  aprovarEmissaoAction,
  criarEmissaoAction,
  editarEmissaoAction,
  enviarParaAnaliseAction,
  reenviarEmissaoAction,
  reprovarEmissaoAction,
} from "@/src/server/actions/emissao";
import {
  estadoDerivadoDoItem,
  estadoInicialAcaoEmissao,
  formatarDataHoraDigitada,
  LABEL_POR_ESTADO_DO_ITEM,
  LABEL_POR_SETOR,
  lancamentosDoItem,
  linhaDeServicoDaCaixa,
  mensagemDeErro,
  minutosDaLinhaDeServico,
  resumoDaEmissao,
  SETOR_PADRAO,
  SETORES,
  validarLancamentoDaCaixa,
  type EstadoAcaoEmissao,
  type EstadoDoItem,
  type LancamentoDaCaixa,
  type ModoDeLancamento,
  type ResultadoDaCaixa,
} from "@/src/server/actions/emissao-estado";
import { BADGE_POR_STATUS } from "./tipos";
import type {
  AtivoOpcao,
  EmissaoListagem,
  ItemRevisionalOpcao,
  PessoaOpcao,
  PlanoOpcao,
  UsuarioOpcao,
} from "./tipos";

type AbaModal = "geral" | "itens" | "servico";

// Valor de um <input type="datetime-local">: "YYYY-MM-DDTHH:mm". Lido com os
// getters getUTC* de propósito, para casar com parseDataHora
// (emissao-estado.ts), que interpreta a string enviada como wall-clock UTC:
// os dois lados tratam o valor como o relógio de parede que o usuário
// digitou, então o round trip salvar -> reabrir devolve a mesma hora. Getters
// locais aqui quebrariam isso — o browser é UTC-3 e o servidor Vercel roda em
// UTC, o que deslocava 3h a cada reabertura.
// Decisão consciente e seu limite: o produto é single-timezone pt-BR
// (internacionalização é non-goal explícito do SPEC); precisa ser revisto se
// algum dia atender múltiplos fusos.
function paraDatetimeLocal(data: Date | null): string {
  if (!data) return "";
  const doisDigitos = (valor: number) => String(valor).padStart(2, "0");
  return (
    `${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())}` +
    `T${doisDigitos(data.getUTCHours())}:${doisDigitos(data.getUTCMinutes())}`
  );
}

// useFormStatus só funciona num componente descendente do <form> — mesmo
// padrão de Acoes em src/components/planos-revisionais/modal-plano.tsx.
function Acoes({ onFechar }: { onFechar: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="modal-footer">
      <button className="btn btn-ghost" type="button" onClick={onFechar} disabled={pending}>
        Cancelar
      </button>
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar emissão"}
      </button>
    </div>
  );
}

// useFormStatus só funciona num componente descendente do <form> que a
// action pertence — mesmo motivo de Acoes acima e de BotaoExcluirSubmit em
// tabela-planos.tsx.
function SubmitTransicao({
  label,
  pendingLabel,
  variante,
}: {
  label: string;
  pendingLabel: string;
  variante: "btn-primary" | "btn-ghost" | "btn-subtle";
}) {
  const { pending } = useFormStatus();
  return (
    <button className={`btn ${variante}`} type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

// Um form isolado por transição (Code Map) — mesmo padrão de BotaoExcluir/
// BotaoExcluirSubmit em tabela-planos.tsx: useActionState próprio (nunca
// compartilha o `estado`/formAction do form principal de Salvar), só com
// emissaoId+updatedAt como payload. Ação bem-sucedida chama onSucesso (fecha
// o modal e revalida), igual ao form principal.
function BotaoTransicao({
  acao,
  emissao,
  label,
  pendingLabel,
  variante,
  onSucesso,
}: {
  acao: (estadoAnterior: EstadoAcaoEmissao, formData: FormData) => Promise<EstadoAcaoEmissao>;
  emissao: EmissaoListagem;
  label: string;
  pendingLabel: string;
  variante: "btn-primary" | "btn-ghost" | "btn-subtle";
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(acao, estadoInicialAcaoEmissao);

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <form action={formAction} style={{ display: "inline-block" }}>
      <input type="hidden" name="emissaoId" value={emissao.id} />
      <input type="hidden" name="updatedAt" value={emissao.updatedAt.toISOString()} />
      <SubmitTransicao label={label} pendingLabel={pendingLabel} variante={variante} />
      {erro ? (
        <div className="form-error" style={{ marginTop: 8, marginBottom: 0 }}>
          {erro}
        </div>
      ) : null}
    </form>
  );
}

// useFormStatus só funciona num componente descendente do <form> — mesmo
// motivo de SubmitTransicao acima. Usado pelo Cancelar de FormReprovar, que
// (diferente do Cancelar de Acoes, dentro do mesmo <form> que o Salvar) fica
// no MESMO form que o botão de Confirmar reprovação, então também precisa
// desabilitar enquanto a reprovação está em voo.
function CancelarTransicao({ onCancelar }: { onCancelar: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-ghost" type="button" onClick={onCancelar} disabled={pending}>
      Cancelar
    </button>
  );
}

// Textarea revelado no cliente (toggle local) em vez de window.prompt() —
// Design Notes: o app nunca usou prompt nativo (só confirm() para exclusão),
// um textarea inline mantém a mesma linguagem visual do resto do produto.
function FormReprovar({
  emissao,
  onSucesso,
  onCancelar,
}: {
  emissao: EmissaoListagem;
  onSucesso: () => void;
  onCancelar: () => void;
}) {
  const [estado, formAction] = useActionState(reprovarEmissaoAction, estadoInicialAcaoEmissao);

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <form action={formAction}>
      <input type="hidden" name="emissaoId" value={emissao.id} />
      <input type="hidden" name="updatedAt" value={emissao.updatedAt.toISOString()} />
      <div className="f">
        <label htmlFor="emissao-motivo-reprovacao">Motivo da reprovação</label>
        <textarea id="emissao-motivo-reprovacao" name="motivo" rows={3} required />
      </div>
      {erro ? <div className="form-error">{erro}</div> : null}
      <div className="row" style={{ gap: 10, marginTop: 10 }}>
        <SubmitTransicao label="Confirmar reprovação" pendingLabel="Reprovando..." variante="btn-primary" />
        <CancelarTransicao onCancelar={onCancelar} />
      </div>
    </form>
  );
}

// Botões contextuais de EmAnalise (Code Map): Aprovar direto, ou Reprovar
// que revela o textarea de motivo (FormReprovar) — toggle local, nunca os
// dois forms montados ao mesmo tempo.
function AcoesEmAnalise({
  emissao,
  onSucesso,
}: {
  emissao: EmissaoListagem;
  onSucesso: () => void;
}) {
  const [mostrarReprovar, setMostrarReprovar] = useState(false);

  if (mostrarReprovar) {
    return (
      <FormReprovar
        emissao={emissao}
        onSucesso={onSucesso}
        onCancelar={() => setMostrarReprovar(false)}
      />
    );
  }

  return (
    <div className="row" style={{ gap: 10 }}>
      <BotaoTransicao
        acao={aprovarEmissaoAction}
        emissao={emissao}
        label="Aprovar"
        pendingLabel="Aprovando..."
        variante="btn-primary"
        onSucesso={onSucesso}
      />
      <button className="btn btn-ghost" type="button" onClick={() => setMostrarReprovar(true)}>
        Reprovar
      </button>
    </div>
  );
}

// Bloco "Status" da aba Geral (Story 4.2, Code Map): badge do status atual
// (mesmo mapa de tabela-emissao.tsx, via tipos.ts) + motivoReprovacao visível
// sempre que preenchido (não só quando Reprovado — depois de um reenvio a
// emissão já está de volta em EmAnalise, mas o motivo da reprovação anterior
// continua no banco e é exatamente o que quem está revisando o reenvio quer
// ver) + botões contextuais por status (Rascunho -> enviar; EmAnalise ->
// aprovar/reprovar; Reprovado -> reenviar; Emitido -> nenhum, nenhum AC pede
// bloqueio de itens neste status — Design Notes). Só renderizado em modo
// edição: uma emissão em criação ainda não tem id/updatedAt persistidos para
// nenhuma transição operar sobre.
function BlocoStatus({
  emissao,
  onSucesso,
}: {
  emissao: EmissaoListagem;
  onSucesso: () => void;
}) {
  const badge = BADGE_POR_STATUS[emissao.status];

  return (
    <div className="status-block" style={{ marginBottom: 20 }}>
      <div className="form-row-label">Status</div>
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        <StatusBadge tom={badge.tom} label={badge.label} />
      </div>
      {emissao.motivoReprovacao ? (
        <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
          Motivo da última reprovação: {emissao.motivoReprovacao}
        </p>
      ) : null}
      {emissao.status === "Rascunho" ? (
        <BotaoTransicao
          acao={enviarParaAnaliseAction}
          emissao={emissao}
          label="Enviar para análise"
          pendingLabel="Enviando..."
          variante="btn-subtle"
          onSucesso={onSucesso}
        />
      ) : null}
      {emissao.status === "EmAnalise" ? (
        <AcoesEmAnalise emissao={emissao} onSucesso={onSucesso} />
      ) : null}
      {emissao.status === "Reprovado" ? (
        <BotaoTransicao
          acao={reenviarEmissaoAction}
          emissao={emissao}
          label="Reenviar para análise"
          pendingLabel="Reenviando..."
          variante="btn-subtle"
          onSucesso={onSucesso}
        />
      ) : null}
    </div>
  );
}

const CONTROLES: {
  key: "dias" | "km" | "horas";
  label: string;
  campoMedicao: (itemRevisionalId: string) => string;
}[] = [
  { key: "dias", label: "Dias", campoMedicao: (id) => `itemMedicaoDias-${id}` },
  { key: "km", label: "Km", campoMedicao: (id) => `itemMedicaoKm-${id}` },
  { key: "horas", label: "Horas", campoMedicao: (id) => `itemMedicaoHoras-${id}` },
];

// Uma linha do checklist fixo da aba Itens — nome/controles sempre vêm do
// ItemRevisional real (itensRevisionaisPorId); valorEsperado/executado/
// medição/observação vêm da origem apropriada (linha existente da própria
// emissão OU item atual do plano selecionado, conforme montarLinhas abaixo).
type LinhaItem = {
  itemRevisionalId: string;
  nome: string;
  descricao: string | null;
  controles: { key: "dias" | "km" | "horas"; label: string; valorEsperado: number | null; campoMedicao: string }[];
  executadoInicial: boolean;
  medicaoInicial: { dias: number | null; km: number | null; horas: number | null };
  observacaoInicial: string;
};

function controlesReais(itemReal: ItemRevisionalOpcao | undefined) {
  if (!itemReal) return [] as { key: "dias" | "km" | "horas"; padrao: number | null }[];
  return CONTROLES.filter((controle) =>
    controle.key === "dias"
      ? itemReal.diasPadrao !== null
      : controle.key === "km"
        ? itemReal.kmPadrao !== null
        : itemReal.horasPadrao !== null,
  ).map((controle) => ({
    key: controle.key,
    padrao:
      controle.key === "dias"
        ? itemReal.diasPadrao
        : controle.key === "km"
          ? itemReal.kmPadrao
          : itemReal.horasPadrao,
  }));
}

// Usado só na linha de item JÁ REGISTRADA (branch `emissao && !trocouPlano`
// de `linhas` abaixo) — um controle aparece se o ItemRevisional ATUAL ainda
// o tem (padrão não-nulo) OU se o snapshot já persistido na emissão tem
// valorEsperado não-nulo para ele. Sem esse OR, editar o Item revisional de
// origem para remover um controle escondia o campo de medição dele ao
// reabrir a emissão para edição; como o campo escondido nunca é enviado no
// FormData, o fluxo update-in-place (montarItensExistentes/atualizarEmissao)
// sobrescrevia a medição já registrada com null, apagando dado real de
// execução em silêncio. A outra branch (criação/troca de plano) não usa
// esta função — lá só existem itens atuais do plano, sem snapshot prévio
// para preservar.
function controlesParaLinhaExistente(
  itemReal: ItemRevisionalOpcao | undefined,
  item: {
    valorEsperadoDias: number | null;
    valorEsperadoKm: number | null;
    valorEsperadoHoras: number | null;
  },
) {
  return CONTROLES.filter((controle) => {
    const padrao =
      controle.key === "dias"
        ? (itemReal?.diasPadrao ?? null)
        : controle.key === "km"
          ? (itemReal?.kmPadrao ?? null)
          : (itemReal?.horasPadrao ?? null);
    const valorEsperado =
      controle.key === "dias"
        ? item.valorEsperadoDias
        : controle.key === "km"
          ? item.valorEsperadoKm
          : item.valorEsperadoHoras;
    return padrao !== null || valorEsperado !== null;
  });
}

// Instante atual como valor de <input type="datetime-local"> (mockup:
// nowLocalDateTime, L2084). Getters LOCAIS aqui, ao contrário de
// paraDatetimeLocal acima: o que se quer é o relógio de parede de quem está
// preenchendo. A string resultante entra no mesmo fluxo de sempre —
// parseDataHora a interpreta como wall-clock e paraDatetimeLocal a devolve
// idêntica ao reabrir —, então o round trip continua fechado.
function agoraDatetimeLocal(): string {
  const agora = new Date();
  const doisDigitos = (valor: number) => String(valor).padStart(2, "0");
  return (
    `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}` +
    `T${doisDigitos(agora.getHours())}:${doisDigitos(agora.getMinutes())}`
  );
}

// Uma linha da tabela da aba Itens (Story 7.4, UX-DR15) — <tr> do mockup, mais
// a <tr> irmã da caixa de lançamento (UX-DR17).
//
// `marcado` NÃO vive mais aqui (Story 7.4/Design Notes): ele subiu para o modal
// porque o estado derivado o consome junto dos lançamentos. O que continua
// local é só o que ninguém mais precisa saber: se a caixa está aberta e o que
// está digitado dentro dela.
//
// Medição e observação seguem NÃO-CONTROLADAS, lidas do FormData no submit:
// elas não alimentam derivação nenhuma, e campo desabilitado não entra no
// FormData — é esse comportamento que faz "item não executado não grava
// medição" (Story 5.5). Desmarcar desabilita sem apagar; remarcar devolve os
// valores porque a linha nunca é remontada.
function LinhaItemEmissaoRow({
  linha,
  marcado,
  onMarcar,
  estado,
  lancamentos,
  pessoas,
  onLancar,
  onRemoverLancamento,
}: {
  linha: LinhaItem;
  marcado: boolean;
  onMarcar: (marcado: boolean) => void;
  estado: EstadoDoItem;
  lancamentos: LinhaServico[];
  pessoas: PessoaOpcao[];
  onLancar: (entrada: LancamentoDaCaixa) => ResultadoDaCaixa;
  onRemoverLancamento: (chave: number) => void;
}) {
  const [aberta, setAberta] = useState(false);
  const [pessoaId, setPessoaId] = useState("");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [erroDaCaixa, setErroDaCaixa] = useState<string | undefined>(undefined);

  // Desmarcar recolhe a caixa (mockup: toggleItemTr, L2359). Ajuste durante o
  // render, nunca em efeito — mesmo padrão do reposicionamento de aba no modal:
  // setState dentro de useEffect dispara render em cascata e é barrado pelo
  // lint do projeto.
  if (!marcado && aberta) setAberta(false);

  const nomeDaPessoa = (id: string) => pessoas.find((pessoa) => pessoa.id === id)?.nome ?? "—";

  const abrirCaixa = () => {
    // Só o INÍCIO nasce pré-preenchido com o instante atual, e só quando ainda
    // está vazio (para não descartar o que a pessoa digitou e não confirmou ao
    // fechar e reabrir). Pessoa fica vazia de propósito: escolher a primeira da
    // lista atribuiria o trabalho a alguém sem decisão humana e neutralizaria a
    // regra "pessoa obrigatória". O fim também fica vazio — pré-preenchê-lo com
    // o mesmo instante do início faria a caixa nascer num estado que o próprio
    // validador recusa ("o fim precisa ser depois do início").
    setInicio((atual) => atual || agoraDatetimeLocal());
    setErroDaCaixa(undefined);
    setAberta(true);
  };

  const confirmar = () => {
    const resultado = onLancar({ pessoaId, inicio, fim });
    if (resultado.tipo === "recusado") {
      // Recusa, nunca zero (NFR7/AD-30): nada é acrescentado e a mensagem fica
      // visível NA caixa — o mockup usa alert() e aceita períodos acima do teto
      // e sem pessoa (Boundaries: divergir).
      setErroDaCaixa(resultado.mensagem);
      return;
    }
    setErroDaCaixa(undefined);
    // Próximo lançamento parte do instante atual de novo — fim vazio, pelo
    // mesmo motivo de abrirCaixa.
    setInicio(agoraDatetimeLocal());
    setFim("");
  };

  return (
    <>
      <tr className={`st-${estado}`}>
        <td className="col-chk">
          <input
            type="checkbox"
            aria-label={`Item executado: ${linha.nome}`}
            name={`itemExecutado-${linha.itemRevisionalId}`}
            checked={marcado}
            onChange={(evento) => onMarcar(evento.target.checked)}
          />
        </td>
        <td className="col-item">
          {linha.nome}
          <div>
            <span className={`st-tag st-${estado}`}>
              <span className="dot" />
              {LABEL_POR_ESTADO_DO_ITEM[estado]}
            </span>
          </div>
        </td>
        {/* Descrição real do ItemRevisional (mockup); travessão quando nula.
            O valor esperado de cada controle vive junto do medidor dele, onde
            é útil para comparar com o que foi medido. */}
        <td className="col-desc">{linha.descricao?.trim() ? linha.descricao : "—"}</td>
        <td>
          <div className="medidores">
            {linha.controles.map((controle) => {
              const valorInicial =
                controle.key === "dias"
                  ? linha.medicaoInicial.dias
                  : controle.key === "km"
                    ? linha.medicaoInicial.km
                    : linha.medicaoInicial.horas;
              return (
                <div className="f" key={controle.key}>
                  <label htmlFor={controle.campoMedicao}>
                    {controle.label}
                    {controle.valorEsperado === null
                      ? null
                      : ` (esperado: ${controle.valorEsperado})`}
                  </label>
                  <input
                    id={controle.campoMedicao}
                    name={controle.campoMedicao}
                    type="number"
                    min={0}
                    defaultValue={valorInicial ?? ""}
                    disabled={!marcado}
                  />
                </div>
              );
            })}
          </div>
        </td>
        <td>
          <div className="f">
            <input
              id={`itemObs-${linha.itemRevisionalId}`}
              name={`itemObs-${linha.itemRevisionalId}`}
              type="text"
              aria-label={`Observação: ${linha.nome}`}
              defaultValue={linha.observacaoInicial}
              disabled={!marcado}
            />
          </div>
        </td>
        <td className="col-acao">
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={!marcado}
            onClick={() => (aberta ? setAberta(false) : abrirCaixa())}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Serviço
          </button>
        </td>
      </tr>
      {aberta ? (
        <tr className="item-servico-tr">
          <td />
          <td colSpan={5} className="item-servico-box">
            <div className="servico-existentes">
              <div className="sx-title">
                {lancamentos.length === 0
                  ? "Serviços lançados neste item"
                  : `Serviços lançados neste item (${lancamentos.length})`}
              </div>
              {lancamentos.length === 0 ? (
                <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                  Nenhum serviço lançado ainda.
                </p>
              ) : (
                lancamentos.map((lancamento) => {
                  const total = minutosDaLinhaDeServico(lancamento);
                  return (
                    <div className="sx-item" key={lancamento.chave}>
                      <span className="sx-pessoa">{nomeDaPessoa(lancamento.pessoaId)}</span>
                      <span className="sx-periodo">
                        {lancamento.modo === "Duracao"
                          ? "Lançamento por horas"
                          : `${formatarDataHoraDigitada(lancamento.inicio)} → ${formatarDataHoraDigitada(lancamento.fim)}`}
                      </span>
                      <span className="sx-horas">
                        {total.tipo === "ok" ? formatarMinutos(total.minutos) : DURACAO_INVALIDA}
                      </span>
                      {/* Remove da MESMA lista que a aba Serviço edita — some
                          dos dois lados e o rodapé recalcula sozinho. */}
                      <button
                        className="icon-btn"
                        type="button"
                        title="Remover serviço"
                        aria-label={`Remover lançamento de ${nomeDaPessoa(lancamento.pessoaId)}`}
                        onClick={() => onRemoverLancamento(lancamento.chave)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
                        </svg>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            {/* Sem `name` em nenhum destes campos, de propósito: a caixa não
                submete nada por si — ela escreve em `linhasServico`, e são os
                inputs `servico-{i}-*` da aba Serviço que vão ao FormData. */}
            <div className="servico-inline">
              <div className="f">
                <label htmlFor={`caixa-pessoa-${linha.itemRevisionalId}`}>Pessoa</label>
                <select
                  id={`caixa-pessoa-${linha.itemRevisionalId}`}
                  value={pessoaId}
                  onChange={(evento) => setPessoaId(evento.target.value)}
                >
                  <option value="">Selecione a pessoa</option>
                  {pessoas.map((pessoa) => (
                    <option key={pessoa.id} value={pessoa.id}>
                      {pessoa.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div className="f" style={{ width: 200 }}>
                <label htmlFor={`caixa-inicio-${linha.itemRevisionalId}`}>Data/hora início</label>
                <input
                  id={`caixa-inicio-${linha.itemRevisionalId}`}
                  type="datetime-local"
                  value={inicio}
                  onChange={(evento) => setInicio(evento.target.value)}
                />
              </div>
              <div className="f" style={{ width: 200 }}>
                <label htmlFor={`caixa-fim-${linha.itemRevisionalId}`}>Data/hora fim</label>
                <input
                  id={`caixa-fim-${linha.itemRevisionalId}`}
                  type="datetime-local"
                  value={fim}
                  onChange={(evento) => setFim(evento.target.value)}
                />
              </div>
              <button className="btn btn-primary btn-sm" type="button" onClick={confirmar}>
                Adicionar ao serviço
              </button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setAberta(false)}>
                Fechar
              </button>
            </div>
            <ErroDeCampo mensagem={erroDaCaixa} alerta />
          </td>
        </tr>
      ) : null}
    </>
  );
}

// Uma linha da aba "Serviço" (Story 5.5, reescrita como <tr> da tabela do
// mockup na 7.3 — UX-DR16). `indice` é só o que compõe o NOME dos campos no
// FormData (`servico-{i}-*`, convenção indexada do Boundaries); a identidade
// React da linha vem da `key` estável do chamador, nunca do índice.
//
// Story 7.3 — a linha passa a ser CONTROLADA (Design Notes): o total da linha e
// o acumulado do rodapé recalculam a cada tecla, e a coluna "Início / Horas"
// troca de natureza conforme o modo. Os dois exigem que o componente conheça os
// valores, o que inputs não-controlados não permitiam.
type LinhaServico = {
  chave: number;
  pessoaId: string;
  itemRevisionalId: string;
  modo: ModoDeLancamento;
  /// Texto do modo `Duracao` ("1:55"). O cliente NUNCA envia o total calculado
  /// (AD-29) — o servidor reinterpreta este mesmo texto.
  horas: string;
  inicio: string;
  fim: string;
};

// `alerta` marca a mensagem com role="alert" para o leitor de tela anunciá-la
// assim que ela aparece — a caixa de lançamento da linha precisa disso porque
// substituiu o alert() do mockup, que era anunciado. Os erros das células da
// aba Serviço vêm de um submit e já têm o banner do topo, então não precisam.
function ErroDeCampo({
  mensagem,
  alerta = false,
}: {
  mensagem: string | undefined;
  alerta?: boolean;
}) {
  if (!mensagem) return null;
  return (
    <div
      className="form-error"
      role={alerta ? "alert" : undefined}
      style={{ margin: "6px 0 0", padding: "6px 8px", fontSize: 11.5 }}
    >
      {mensagem}
    </div>
  );
}

function LinhaServicoRow({
  indice,
  linha,
  pessoas,
  itensRevisionais,
  erros,
  onMudar,
  onRemover,
}: {
  indice: number;
  linha: LinhaServico;
  pessoas: PessoaOpcao[];
  itensRevisionais: ItemRevisionalOpcao[];
  erros: Map<string, string>;
  onMudar: (campos: Partial<LinhaServico>) => void;
  onRemover: () => void;
}) {
  // Só itens revisionais "Ativo" ficam selecionáveis para um vínculo novo
  // (mesmo critério de opcoesAtivo/opcoesPlano e da Story 5.4 para cargo/
  // função); o item que ESTA linha já referencia continua na lista mesmo se
  // arquivado depois, para a edição não perder o valor existente.
  const opcoesItem = itensRevisionais.filter(
    (item) => item.status === "Ativo" || item.id === linha.itemRevisionalId,
  );
  const prefixo = `servico-${indice}`;
  const total = minutosDaLinhaDeServico(linha);

  return (
    <tr>
      <td>
        <select
          id={`${prefixo}-itemRevisionalId`}
          name={`${prefixo}-itemRevisionalId`}
          aria-label="Item revisional"
          value={linha.itemRevisionalId}
          onChange={(evento) => onMudar({ itemRevisionalId: evento.target.value })}
        >
          <option value="">Selecione o item</option>
          {opcoesItem.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nome}
            </option>
          ))}
        </select>
        <ErroDeCampo mensagem={erros.get(`${prefixo}-itemRevisionalId`)} />
      </td>
      <td>
        <select
          id={`${prefixo}-pessoaId`}
          name={`${prefixo}-pessoaId`}
          aria-label="Pessoa"
          value={linha.pessoaId}
          onChange={(evento) => onMudar({ pessoaId: evento.target.value })}
        >
          <option value="">Selecione a pessoa</option>
          {pessoas.map((pessoa) => (
            <option key={pessoa.id} value={pessoa.id}>
              {pessoa.nome}
            </option>
          ))}
        </select>
        <ErroDeCampo mensagem={erros.get(`${prefixo}-pessoaId`)} />
      </td>
      <td>
        <select
          id={`${prefixo}-modo`}
          name={`${prefixo}-modo`}
          aria-label="Modo de lançamento"
          value={linha.modo}
          onChange={(evento) => onMudar({ modo: evento.target.value as ModoDeLancamento })}
        >
          <option value="Duracao">Apenas horas</option>
          <option value="Periodo">Data/hora início e fim</option>
        </select>
        <ErroDeCampo mensagem={erros.get(`${prefixo}-modo`)} />
      </td>
      {/* A mesma célula hospeda os dois modos (mockup). Os NOMES continuam
          distintos por modo de propósito (Design Notes): o campo do erro diz
          qual regra falhou, e um erro de duração nunca aparece grudado num
          input de data/hora que não está sequer na tela. O input do modo
          inativo não é renderizado, então não entra no FormData. */}
      {linha.modo === "Duracao" ? (
        <>
          <td>
            <input
              id={`${prefixo}-horas`}
              name={`${prefixo}-horas`}
              type="text"
              inputMode="text"
              placeholder="1:55"
              aria-label="Horas trabalhadas"
              value={linha.horas}
              onChange={(evento) => onMudar({ horas: evento.target.value })}
            />
            <ErroDeCampo mensagem={erros.get(`${prefixo}-horas`)} />
          </td>
          <td className="muted">—</td>
        </>
      ) : (
        <>
          <td>
            <input
              id={`${prefixo}-inicio`}
              name={`${prefixo}-inicio`}
              type="datetime-local"
              aria-label="Início do serviço"
              value={linha.inicio}
              onChange={(evento) => onMudar({ inicio: evento.target.value })}
            />
            <ErroDeCampo mensagem={erros.get(`${prefixo}-inicio`)} />
          </td>
          <td>
            <input
              id={`${prefixo}-fim`}
              name={`${prefixo}-fim`}
              type="datetime-local"
              aria-label="Fim do serviço"
              value={linha.fim}
              onChange={(evento) => onMudar({ fim: evento.target.value })}
            />
            <ErroDeCampo mensagem={erros.get(`${prefixo}-fim`)} />
          </td>
        </>
      )}
      <td className="col-total">
        {total.tipo === "ok" ? formatarMinutos(total.minutos) : DURACAO_INVALIDA}
      </td>
      <td className="col-acao-sv">
        <button className="icon-btn" type="button" title="Remover serviço" onClick={onRemover}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
          </svg>
        </button>
      </td>
    </tr>
  );
}

// Modal tabbed Geral/Itens/Serviço, clonando o padrão de modal-plano.tsx (Code Map).
// emissao === null -> modo criação; emissao preenchida -> modo edição. SEM
// campo de Status editável (Boundaries: emissão nasce sempre em Rascunho, o
// avanço de status é a Story 4.2).
//
// A aba Itens é um checklist FIXO dos itens do plano vigente (Code Map),
// nunca um picker de seleção: quando o plano selecionado é o mesmo já
// vinculado à emissão em edição, as linhas vêm dos itens JÁ REGISTRADOS
// dela (preserva progresso, Boundaries); quando o plano selecionado é
// diferente (criação, ou troca de plano numa edição), as linhas vêm dos
// itens ATUAIS do plano escolhido, com um snapshot do valor esperado
// calculado no cliente só para pré-visualização — o servidor recalcula e
// grava o snapshot de verdade (emissao-estado.ts:calcularValorEsperado),
// nunca confia neste valor vindo do cliente.
export function ModalEmissao({
  emissao,
  ativos,
  planos,
  usuarios,
  itensRevisionais,
  pessoas,
  onFechar,
  onSucesso,
}: {
  emissao: EmissaoListagem | null;
  ativos: AtivoOpcao[];
  planos: PlanoOpcao[];
  usuarios: UsuarioOpcao[];
  itensRevisionais: ItemRevisionalOpcao[];
  pessoas: PessoaOpcao[];
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const acao = emissao ? editarEmissaoAction : criarEmissaoAction;
  const [estado, formAction] = useActionState(acao, estadoInicialAcaoEmissao);
  const [aba, setAba] = useState<AbaModal>("geral");
  const [ativoId, setAtivoId] = useState(emissao?.ativoId ?? "");
  const [planoId, setPlanoId] = useState(emissao?.planoId ?? "");
  const [responsavelId, setResponsavelId] = useState(emissao?.responsavelId ?? "");
  const [setor, setSetor] = useState(emissao?.setor ?? SETOR_PADRAO);

  // Linhas da aba Serviço: agora TODO o valor é estado (Story 7.3/Design
  // Notes) — o total da linha e o acumulado dependem dele. `chave` continua um
  // contador local monotônico — nunca o índice do array (Boundaries): remover
  // uma linha do meio com key=índice reembaralharia as linhas seguintes.
  //
  // A ida e volta da edição vive aqui: uma linha gravada como `Duracao` volta
  // com o modo dela e com os minutos reformatados pelo MESMO `formatarMinutos`
  // que o servidor reinterpreta com `interpretarDuracao` — "115" -> "1:55" ->
  // 115. Sem isso, reabrir e salvar transformaria a linha em `Periodo` vazio.
  const [linhasServico, setLinhasServico] = useState<LinhaServico[]>(() =>
    (emissao?.servicos ?? []).map((servico, indice) => ({
      chave: indice,
      pessoaId: servico.pessoaId,
      itemRevisionalId: servico.itemRevisionalId,
      modo: servico.modo,
      horas: servico.duracaoMinutos === null ? "" : formatarMinutos(servico.duracaoMinutos),
      inicio: paraDatetimeLocal(servico.inicio),
      fim: paraDatetimeLocal(servico.fim),
    })),
  );
  // Contador em ref (não em estado): a chave é derivada no próprio momento da
  // inserção, então duas chamadas dentro de um mesmo batch de render nunca
  // podem ler o mesmo valor "antigo" do closure e gerar duas linhas com a
  // mesma `key`.
  const proximaChave = useRef((emissao?.servicos.length ?? 0) + 1);

  // Os erros de campo de serviço são indexados por POSIÇÃO
  // (`servico-{i}-horas`) e vêm do último submit — remover uma linha acima da
  // culpada faria a mensagem antiga pintar a linha errada. Qualquer mudança nas
  // linhas os marca como obsoletos; só uma nova resposta da action os traz de
  // volta.
  const [errosDeServicoObsoletos, setErrosDeServicoObsoletos] = useState(false);

  const adicionarServico = () => {
    setErrosDeServicoObsoletos(true);
    const chave = proximaChave.current;
    proximaChave.current += 1;
    setLinhasServico((atual) => [
      ...atual,
      // Nasce em "Apenas horas", como no mockup: é o lançamento que a story
      // existe para permitir.
      { chave, pessoaId: "", itemRevisionalId: "", modo: "Duracao", horas: "", inicio: "", fim: "" },
    ]);
  };

  const removerServico = (chave: number) => {
    setErrosDeServicoObsoletos(true);
    setLinhasServico((atual) => atual.filter((linha) => linha.chave !== chave));
  };

  const mudarServico = (chave: number, campos: Partial<LinhaServico>) => {
    setErrosDeServicoObsoletos(true);
    setLinhasServico((atual) =>
      atual.map((linha) => (linha.chave === chave ? { ...linha, ...campos } : linha)),
    );
  };

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  // Erro de campo numa linha de serviço: o banner de erro fica no topo do
  // modal, mas os campos culpados estão na aba Serviço — trazer o usuário
  // para ela evita a mensagem "solta", sem dono visível, quando ele está na
  // aba Geral. Ajuste feito DURANTE o render (comparando com o último estado
  // já tratado), nunca num efeito: setState dentro de efeito dispara render
  // em cascata e é barrado pelo lint do projeto. Depois disso o usuário
  // continua livre para trocar de aba — só uma NOVA resposta da action
  // reposiciona.
  const [estadoTratado, setEstadoTratado] = useState(estado);
  if (estado !== estadoTratado) {
    setEstadoTratado(estado);
    // Resposta nova: os erros de serviço dela descrevem as linhas atuais.
    setErrosDeServicoObsoletos(false);
    if (
      !estado.ok &&
      Array.isArray(estado.error) &&
      // "servico" sem hífen: cobre tanto os campos indexados
      // (`servico-{i}-horas`) quanto o desfecho de linha incoerente devolvido
      // pelo repositório (`servico-lancamentos`).
      estado.error.some((item) => item.field.startsWith("servico"))
    ) {
      setAba("servico");
    }
  }

  const erro = mensagemDeErro(estado.error);

  // Erros por campo, para a mensagem aparecer NA célula culpada (a story) além
  // do banner do topo.
  const errosPorCampo = useMemo(() => {
    const mapa = new Map<string, string>();
    if (Array.isArray(estado.error)) {
      for (const item of estado.error) {
        // Um erro de serviço já obsoleto some por inteiro em vez de grudar
        // numa linha que hoje é outra.
        if (errosDeServicoObsoletos && item.field.startsWith("servico")) continue;
        if (!mapa.has(item.field)) mapa.set(item.field, item.message);
      }
    }
    return mapa;
  }, [estado.error, errosDeServicoObsoletos]);

  const itensRevisionaisPorId = useMemo(
    () => new Map(itensRevisionais.map((item) => [item.id, item])),
    [itensRevisionais],
  );

  // Só ativos/planos com status "Ativo" ficam selecionáveis para um vínculo
  // novo — mesmo critério de opcoesVinculo em modal-plano.tsx. O vínculo
  // atual da emissão em edição sempre aparece na lista mesmo que tenha sido
  // desativado/arquivado depois (edição não pode perder silenciosamente o
  // vínculo existente). Sem filtragem cruzada entre os dois dropdowns
  // (Boundaries) — cada um lista independentemente.
  const opcoesAtivo = ativos.filter(
    (ativo) => ativo.status === "Ativo" || ativo.id === emissao?.ativoId,
  );
  const opcoesPlano = planos.filter(
    (plano) => plano.status === "Ativo" || plano.id === emissao?.planoId,
  );

  const planoOriginalId = emissao?.planoId ?? null;
  const trocouPlano = emissao !== null && planoId !== planoOriginalId;

  const linhas: LinhaItem[] = useMemo(() => {
    if (emissao && !trocouPlano) {
      // Plano não mudou (ou é a própria criação de uma emissão cujo plano
      // ainda não foi trocado de novo depois de já ter voltado ao
      // original): linhas vêm dos itens JÁ REGISTRADOS na emissão —
      // preserva progresso, nunca resincroniza com o plano atual
      // (Boundaries).
      return emissao.itens.map((item) => {
        const itemReal = itensRevisionaisPorId.get(item.itemRevisionalId);
        return {
          itemRevisionalId: item.itemRevisionalId,
          nome: itemReal?.nome ?? "Item revisional",
          descricao: itemReal?.descricao ?? null,
          controles: controlesParaLinhaExistente(itemReal, item).map((controle) => ({
            key: controle.key,
            label: controle.label,
            valorEsperado:
              controle.key === "dias"
                ? item.valorEsperadoDias
                : controle.key === "km"
                  ? item.valorEsperadoKm
                  : item.valorEsperadoHoras,
            campoMedicao: controle.campoMedicao(item.itemRevisionalId),
          })),
          executadoInicial: item.executado,
          medicaoInicial: {
            dias: item.medicaoDias,
            km: item.medicaoKm,
            horas: item.medicaoHoras,
          },
          observacaoInicial: item.observacao ?? "",
        };
      });
    }

    // Criação, ou edição com plano trocado: linhas vêm dos itens ATUAIS do
    // plano selecionado, checklist fixo (Intent) — nasce tudo não-executado,
    // sem medição/observação prévia.
    const planoSelecionado = planos.find((plano) => plano.id === planoId);
    if (!planoSelecionado) return [];

    return planoSelecionado.itens.map((itemDoPlano) => {
      const itemReal = itensRevisionaisPorId.get(itemDoPlano.itemRevisionalId);
      return {
        itemRevisionalId: itemDoPlano.itemRevisionalId,
        nome: itemReal?.nome ?? "Item revisional",
        descricao: itemReal?.descricao ?? null,
        controles: controlesReais(itemReal).map((controle) => {
          const override =
            controle.key === "dias"
              ? itemDoPlano.diasOverride
              : controle.key === "km"
                ? itemDoPlano.kmOverride
                : itemDoPlano.horasOverride;
          return {
            key: controle.key,
            label: controle.key === "dias" ? "Dias" : controle.key === "km" ? "Km" : "Horas",
            valorEsperado: override ?? controle.padrao,
            campoMedicao: CONTROLES.find((c) => c.key === controle.key)!.campoMedicao(
              itemDoPlano.itemRevisionalId,
            ),
          };
        }),
        executadoInicial: false,
        medicaoInicial: { dias: null, km: null, horas: null },
        observacaoInicial: "",
      };
    });
  }, [emissao, trocouPlano, planoId, planos, itensRevisionaisPorId]);

  // Story 7.4 — `executado` SOBE para o modal (Design Notes): o estado derivado
  // de cada item o consome junto dos lançamentos, e a faixa de resumo da
  // próxima build precisa da contagem. Ler o DOM (`.item-exec:checked`, como o
  // mockup faz na L2262) é justamente o padrão que torna a regra intestável.
  //
  // Antes o estado morava na linha e era ressincronizado pela `key` de
  // remontagem; agora ele vive aqui, então a troca de origem das linhas
  // (criação/troca de plano vs. edição sem troca) precisa reinicializá-lo —
  // durante o render, comparando com a última origem tratada, nunca num
  // useEffect (mesmo padrão do reposicionamento de aba acima).
  const origemDasLinhas = `${emissao?.id ?? "nova"}|${planoId}`;
  const [executados, setExecutados] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(linhas.map((linha) => [linha.itemRevisionalId, linha.executadoInicial])),
  );
  const [origemTratada, setOrigemTratada] = useState(origemDasLinhas);
  if (origemDasLinhas !== origemTratada) {
    setOrigemTratada(origemDasLinhas);
    setExecutados(
      Object.fromEntries(linhas.map((linha) => [linha.itemRevisionalId, linha.executadoInicial])),
    );
  }

  // A precedência do `executado` vive num lugar só (o comentário de
  // emissao-estado.ts conta com isso): entrada ausente no mapa cai no
  // `executadoInicial` da própria linha, nunca num `false` cego — `linhas` é um
  // useMemo que pode ganhar um item sem que `origemDasLinhas` mude, e um
  // `false` aqui gravaria "não executado" para um item que estava executado.
  // Os três consumidores (checkbox, estado derivado e a faixa de resumo) leem
  // este helper.
  const executadoDaLinha = useCallback(
    (linha: LinhaItem) => executados[linha.itemRevisionalId] ?? linha.executadoInicial,
    [executados],
  );

  // Story 7.4 (parte 2) — a faixa de cinco indicadores da aba Geral (UX-DR18).
  // Nenhum dos cinco é gravado, lido do banco ou enviado no FormData (AD-29):
  // todos derivam do estado que o modal já mantém, e recalculam a cada marcação
  // de item ou lançamento sem nenhum submit. A soma de minutos sai DAQUI e
  // alimenta também o rodapé da aba Serviço — uma origem só, para os dois
  // números da mesma tela nunca discordarem.
  const resumo = useMemo(
    () =>
      resumoDaEmissao({
        itens: linhas.map((linha) => ({ executado: executadoDaLinha(linha) })),
        lancamentos: linhasServico,
      }),
    [linhas, executadoDaLinha, linhasServico],
  );

  const marcarItem = (itemRevisionalId: string, marcado: boolean) => {
    setExecutados((atual) => ({ ...atual, [itemRevisionalId]: marcado }));
  };

  // Lançamento vindo da caixa da linha (UX-DR17): entra na MESMA
  // `linhasServico` que a aba Serviço edita e o rodapé soma — nunca uma
  // segunda lista —, sempre no modo `Periodo`, amarrado ao `itemRevisionalId`
  // da linha (nunca ao nome do item, como o mockup faz).
  const lancarPelaCaixa = (
    itemRevisionalId: string,
    entrada: LancamentoDaCaixa,
  ): ResultadoDaCaixa => {
    const resultado = validarLancamentoDaCaixa(entrada);
    if (resultado.tipo === "recusado") return resultado;

    setErrosDeServicoObsoletos(true);
    const chave = proximaChave.current;
    proximaChave.current += 1;
    setLinhasServico((atual) => [
      ...atual,
      { chave, ...linhaDeServicoDaCaixa(itemRevisionalId, entrada) },
    ]);
    return resultado;
  };

  return (
    // `modal-full` (Story 7.3, portado do mockup L1860): a tabela de serviços
    // tem 7 colunas e não cabe nos 760px do modal padrão.
    <div className="modal-overlay modal-full" onClick={onFechar}>
      <div className="modal" onClick={(evento) => evento.stopPropagation()}>
        <div className="modal-header">
          <h2>{emissao ? `Editar emissão · ${emissao.codigo}` : "Nova emissão"}</h2>
          <button className="modal-close" type="button" onClick={onFechar}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-tabs">
          <button
            type="button"
            className={`modal-tab-btn${aba === "geral" ? " active" : ""}`}
            onClick={() => setAba("geral")}
          >
            Geral
          </button>
          <button
            type="button"
            className={`modal-tab-btn${aba === "itens" ? " active" : ""}`}
            onClick={() => setAba("itens")}
          >
            Itens
          </button>
          <button
            type="button"
            className={`modal-tab-btn${aba === "servico" ? " active" : ""}`}
            onClick={() => setAba("servico")}
          >
            Serviço
          </button>
        </div>

        {erro ? (
          <div className="form-error" style={{ margin: "16px 24px 0" }}>
            {erro}
          </div>
        ) : null}

        {emissao ? (
          // Fora do <form> de Salvar (abaixo): cada transição é um form
          // isolado (Code Map) e HTML não permite <form> aninhado — mesmo
          // motivo pelo qual este bloco não pode viver dentro do
          // modal-tab-panel "geral", que é descendente do form principal.
          // Visibilidade por classe ".hidden" (mesmo padrão dos outros
          // modal-tab-panel), NUNCA um `aba === "geral" ? ... : null` que
          // desmonta o componente: uma transição em voo tem seu próprio
          // useActionState/useEffect (BotaoTransicao/FormReprovar) que só
          // dispara onSucesso quando o estado resolve — se o usuário troca
          // de aba enquanto a Server Action ainda está pendente, desmontar
          // perderia esse efeito mesmo com a mutação já concluída no
          // servidor (revalidatePath já rodou), deixando o modal com estado
          // visualmente desatualizado.
          <div className={`modal-tab-panel${aba === "geral" ? "" : " hidden"}`} style={{ padding: "16px 24px 0" }}>
            <BlocoStatus emissao={emissao} onSucesso={onSucesso} />
          </div>
        ) : null}

        <form action={formAction}>
          {emissao ? (
            <>
              <input type="hidden" name="emissaoId" value={emissao.id} />
              <input type="hidden" name="updatedAt" value={emissao.updatedAt.toISOString()} />
            </>
          ) : null}

          <div className="modal-body">
            <div className={`modal-tab-panel${aba === "geral" ? "" : " hidden"}`}>
              <div className="modal-grid">
                <div className="f">
                  <label htmlFor="emissao-ativo">Ativo</label>
                  <select
                    id="emissao-ativo"
                    name="ativoId"
                    required
                    value={ativoId}
                    onChange={(evento) => setAtivoId(evento.target.value)}
                  >
                    <option value="" disabled>
                      Selecione o ativo
                    </option>
                    {opcoesAtivo.map((ativo) => (
                      <option key={ativo.id} value={ativo.id}>
                        {ativo.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="f">
                  <label htmlFor="emissao-setor">Setor</label>
                  <select
                    id="emissao-setor"
                    name="setor"
                    required
                    value={setor}
                    onChange={(evento) => setSetor(evento.target.value as typeof setor)}
                  >
                    {SETORES.map((valor) => (
                      <option key={valor} value={valor}>
                        {LABEL_POR_SETOR[valor]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="f">
                  <label htmlFor="emissao-plano">Plano revisional</label>
                  <select
                    id="emissao-plano"
                    name="planoId"
                    required
                    value={planoId}
                    onChange={(evento) => setPlanoId(evento.target.value)}
                  >
                    <option value="" disabled>
                      Selecione o plano revisional
                    </option>
                    {opcoesPlano.map((plano) => (
                      <option key={plano.id} value={plano.id}>
                        {plano.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="f">
                  <label htmlFor="emissao-responsavel">Responsável</label>
                  <select
                    id="emissao-responsavel"
                    name="responsavelId"
                    required
                    value={responsavelId}
                    onChange={(evento) => setResponsavelId(evento.target.value)}
                  >
                    <option value="" disabled>
                      Selecione o responsável
                    </option>
                    {usuarios.map((usuario) => (
                      <option key={usuario.id} value={usuario.id}>
                        {usuario.nome}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Story 7.4 — as quatro datas agrupadas em `date-row`
                    (mockup L1884). O agrupamento é só de LAYOUT: nenhum dos
                    quatro campos muda de natureza — a data de emissão continua
                    editável e enviada pelo formulário (torná-la somente leitura
                    é a 7.5, AD-33). */}
                <div className="date-row">
                  <div className="f">
                    <label htmlFor="emissao-data">Data de emissão</label>
                    <input
                      id="emissao-data"
                      name="dataEmissao"
                      type="date"
                      required
                      defaultValue={
                        emissao ? emissao.dataEmissao.toISOString().slice(0, 10) : undefined
                      }
                    />
                  </div>
                  {/* Story 5.5: os três marcos são OPCIONAIS (sem `required`) —
                      uma emissão continua salvável só com a data de emissão. */}
                  <div className="f">
                    <label htmlFor="emissao-data-agendamento">Data agendamento</label>
                    <input
                      id="emissao-data-agendamento"
                      name="dataAgendamento"
                      type="datetime-local"
                      defaultValue={paraDatetimeLocal(emissao?.dataAgendamento ?? null)}
                    />
                  </div>
                  <div className="f">
                    <label htmlFor="emissao-data-inicio">Data início</label>
                    <input
                      id="emissao-data-inicio"
                      name="dataInicio"
                      type="datetime-local"
                      defaultValue={paraDatetimeLocal(emissao?.dataInicio ?? null)}
                    />
                  </div>
                  <div className="f">
                    <label htmlFor="emissao-data-fim">Data fim</label>
                    <input
                      id="emissao-data-fim"
                      name="dataFim"
                      type="datetime-local"
                      defaultValue={paraDatetimeLocal(emissao?.dataFim ?? null)}
                    />
                  </div>
                </div>
                {/* UX-DR18 — os cinco indicadores DERIVADOS, DEPOIS do bloco de
                    datas (mockup L1884-1896: `date-row` e em seguida
                    `resumo-row`). Nenhum deles tem `name`: nada aqui viaja no
                    FormData nem existe como coluna.

                    <dl>/<dt>/<dd> em vez de divs nus: a ligação rótulo-valor
                    deixa de ser só visual. As classes do mockup (AD-4) são
                    mantidas. `aria-live="polite"` porque os valores mudam ao
                    vivo, sem submit — é justamente o ponto da funcionalidade. */}
                <dl className="resumo-row" aria-live="polite">
                  <div className="resumo-card">
                    <dt className="rl">Horas acumuladas de serviço</dt>
                    <dd className="rv">{formatarMinutos(resumo.minutosAcumulados)}</dd>
                  </div>
                  <div className="resumo-card">
                    <dt className="rl">Lançamentos de serviço</dt>
                    <dd className="rv">{resumo.lancamentosDeServico}</dd>
                  </div>
                  <div className="resumo-card">
                    <dt className="rl">Itens executados</dt>
                    <dd className="rv">
                      {resumo.itensExecutados} de {resumo.totalDeItens}
                    </dd>
                  </div>
                  <div className="resumo-card">
                    <dt className="rl">Itens não executados</dt>
                    <dd className="rv">{resumo.itensPendentes}</dd>
                  </div>
                  <div className="resumo-card">
                    <dt className="rl">% executado</dt>
                    <dd className="rv">{resumo.percentualExecutado}%</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className={`modal-tab-panel${aba === "itens" ? "" : " hidden"}`}>
              <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                Marque os itens revisionais executados nesta emissão, registre a medição
                realizada e, se necessário, adicione o serviço executado no item.
              </p>
              {linhas.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>
                  {planoId
                    ? "O plano selecionado não tem itens revisionais."
                    : "Selecione um plano revisional na aba Geral."}
                </p>
              ) : (
                <div className="table-wrap table-wrap-rolavel">
                  <table className="itens-table">
                    <thead>
                      <tr>
                        <th scope="col" className="col-chk" />
                        <th scope="col" className="col-item">Item</th>
                        <th scope="col" className="col-desc">Descrição</th>
                        <th scope="col">Medidores (dias, horas, km)</th>
                        <th scope="col">Observação</th>
                        <th scope="col" className="col-acao">Serviço</th>
                      </tr>
                    </thead>
                    <tbody id="emissao-itens-list">
                      {linhas.map((linha) => (
                        <LinhaItemEmissaoRow
                          key={`${planoId}-${linha.itemRevisionalId}`}
                          linha={linha}
                          marcado={executadoDaLinha(linha)}
                          onMarcar={(marcado) => marcarItem(linha.itemRevisionalId, marcado)}
                          estado={estadoDerivadoDoItem({
                            itemRevisionalId: linha.itemRevisionalId,
                            executado: executadoDaLinha(linha),
                            lancamentos: linhasServico,
                          })}
                          lancamentos={lancamentosDoItem(linhasServico, linha.itemRevisionalId)}
                          pessoas={pessoas}
                          onLancar={(entrada) => lancarPelaCaixa(linha.itemRevisionalId, entrada)}
                          onRemoverLancamento={removerServico}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Visibilidade por classe ".hidden" (mesmo padrão dos outros
                painéis), NUNCA desmontando o conteúdo: desmontar o painel ao
                trocar de aba tiraria os campos de serviço do FormData, e o
                submit gravaria zero linhas. */}
            <div className={`modal-tab-panel${aba === "servico" ? "" : " hidden"}`}>
              <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                Selecione o item revisional e informe as horas trabalhadas — lançando apenas a
                duração (ex.: 1:55) ou data/hora de início e fim para o sistema calcular.
              </p>
              {/* Contagem explícita lida pelo servidor (lerServicos) junto
                  dos campos indexados `servico-{i}-*` — nunca getAll()
                  posicional (Boundaries). */}
              <input type="hidden" name="servicoCount" value={linhasServico.length} />
              <ErroDeCampo mensagem={errosPorCampo.get("servico-lancamentos")} />
              <div className="table-wrap table-wrap-rolavel">
                <table className="servicos-table">
                  <thead>
                    <tr>
                      <th scope="col">Item revisional</th>
                      <th scope="col">Pessoa</th>
                      <th scope="col">Lançamento</th>
                      <th scope="col">Início / Horas</th>
                      <th scope="col">Fim</th>
                      <th scope="col" className="col-total">Total</th>
                      <th scope="col" className="col-acao-sv" />
                    </tr>
                  </thead>
                  <tbody id="emissao-servico-list">
                    {linhasServico.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="servicos-empty">
                          Nenhum serviço adicionado ainda.
                        </td>
                      </tr>
                    ) : null}
                    {linhasServico.map((linha, indice) => (
                      <LinhaServicoRow
                        key={linha.chave}
                        indice={indice}
                        linha={linha}
                        pessoas={pessoas}
                        itensRevisionais={itensRevisionais}
                        erros={errosPorCampo}
                        onMudar={(campos) => mudarServico(linha.chave, campos)}
                        onRemover={() => removerServico(linha.chave)}
                      />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>Horas acumuladas de serviço</td>
                      {/* MESMO valor do cartão de horas da aba Geral — uma
                          origem só (`resumo.minutosAcumulados`), para os dois
                          números nunca divergirem em silêncio. */}
                      <td className="col-total">{formatarMinutos(resumo.minutosAcumulados)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={adicionarServico}
                style={{ marginTop: 12 }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Adicionar serviço
              </button>
            </div>
          </div>

          <Acoes onFechar={onFechar} />
        </form>
      </div>
    </div>
  );
}
