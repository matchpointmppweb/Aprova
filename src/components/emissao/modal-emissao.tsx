"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { StatusBadge } from "@/src/components/shared/status-badge";
import {
  aprovarEmissaoAction,
  criarEmissaoAction,
  editarEmissaoAction,
  enviarParaAnaliseAction,
  reenviarEmissaoAction,
  reprovarEmissaoAction,
} from "@/src/server/actions/emissao";
import {
  estadoInicialAcaoEmissao,
  LABEL_POR_SETOR,
  mensagemDeErro,
  SETOR_PADRAO,
  SETORES,
  type EstadoAcaoEmissao,
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

// Uma linha do checklist com estado de "executado" próprio, inicializado a
// partir de `linha.executadoInicial` — remontada (via `key` no chamador,
// que inclui o plano selecionado) sempre que a origem da linha muda
// (criação/troca de plano vs. edição sem troca), então o estado inicial
// nunca precisa ser resincronizado por um useEffect (evita setState em
// cascata dentro de efeito).
function LinhaItemEmissaoRow({ linha }: { linha: LinhaItem }) {
  const [marcado, setMarcado] = useState(linha.executadoInicial);

  return (
    <div className="item-row">
      <label className="item-check">
        <input
          type="checkbox"
          name={`itemExecutado-${linha.itemRevisionalId}`}
          checked={marcado}
          onChange={(evento) => setMarcado(evento.target.checked)}
        />
        <span>{linha.nome}</span>
      </label>
      <div className="item-badges">
        {linha.controles.map((controle) => (
          <span className="tag tag-neutral" key={controle.key}>
            {controle.label} esperado: {controle.valorEsperado ?? "—"}
          </span>
        ))}
      </div>
      <div className="item-fields">
        {linha.controles.map((controle) => {
          const valorInicial =
            controle.key === "dias"
              ? linha.medicaoInicial.dias
              : controle.key === "km"
                ? linha.medicaoInicial.km
                : linha.medicaoInicial.horas;
          return (
            <div className="f" key={controle.key}>
              <label htmlFor={controle.campoMedicao}>{controle.label} medido</label>
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
      <div className="f item-obs">
        <label htmlFor={`itemObs-${linha.itemRevisionalId}`}>Observação</label>
        <input
          id={`itemObs-${linha.itemRevisionalId}`}
          name={`itemObs-${linha.itemRevisionalId}`}
          type="text"
          defaultValue={linha.observacaoInicial}
          disabled={!marcado}
        />
      </div>
    </div>
  );
}

// Uma linha da aba "Serviço" (Story 5.5). `indice` é só o que compõe o NOME
// dos campos no FormData (`servico-{i}-*`, convenção indexada do
// Boundaries); a identidade React da linha vem da `key` estável do chamador,
// nunca do índice — remover uma linha do meio renumera os `name` sem
// remontar os inputs não-controlados, preservando o que o usuário digitou
// em cada linha remanescente.
function LinhaServicoRow({
  indice,
  inicial,
  pessoas,
  itensRevisionais,
  onRemover,
}: {
  indice: number;
  inicial: { pessoaId: string; itemRevisionalId: string; inicio: string; fim: string };
  pessoas: PessoaOpcao[];
  itensRevisionais: ItemRevisionalOpcao[];
  onRemover: () => void;
}) {
  // Só itens revisionais "Ativo" ficam selecionáveis para um vínculo novo
  // (mesmo critério de opcoesAtivo/opcoesPlano e da Story 5.4 para cargo/
  // função); o item que ESTA linha já referencia continua na lista mesmo se
  // arquivado depois, para a edição não perder o valor existente.
  const opcoesItem = itensRevisionais.filter(
    (item) => item.status === "Ativo" || item.id === inicial.itemRevisionalId,
  );

  return (
    <div className="servico-row">
      <div className="f">
        <label htmlFor={`servico-${indice}-pessoaId`}>Pessoa</label>
        <select
          id={`servico-${indice}-pessoaId`}
          name={`servico-${indice}-pessoaId`}
          defaultValue={inicial.pessoaId}
        >
          <option value="">Selecione a pessoa</option>
          {pessoas.map((pessoa) => (
            <option key={pessoa.id} value={pessoa.id}>
              {pessoa.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="f">
        <label htmlFor={`servico-${indice}-inicio`}>Data/hora início</label>
        <input
          id={`servico-${indice}-inicio`}
          name={`servico-${indice}-inicio`}
          type="datetime-local"
          defaultValue={inicial.inicio}
        />
      </div>
      <div className="f">
        <label htmlFor={`servico-${indice}-fim`}>Data/hora fim</label>
        <input
          id={`servico-${indice}-fim`}
          name={`servico-${indice}-fim`}
          type="datetime-local"
          defaultValue={inicial.fim}
        />
      </div>
      <div className="f">
        <label htmlFor={`servico-${indice}-itemRevisionalId`}>Item trabalhado</label>
        <select
          id={`servico-${indice}-itemRevisionalId`}
          name={`servico-${indice}-itemRevisionalId`}
          defaultValue={inicial.itemRevisionalId}
        >
          <option value="">Selecione o item</option>
          {opcoesItem.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nome}
            </option>
          ))}
        </select>
      </div>
      <button
        className="icon-btn servico-remove"
        type="button"
        title="Remover serviço"
        onClick={onRemover}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
        </svg>
      </button>
    </div>
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

  // Linhas da aba Serviço: só a LISTA é estado (add/remover); os valores de
  // cada linha ficam nos próprios inputs não-controlados, lidos do FormData
  // no submit. `chave` é um contador local monotônico — nunca o índice do
  // array (Boundaries): remover uma linha do meio com key=índice
  // reembaralharia os defaultValue das linhas seguintes.
  const [linhasServico, setLinhasServico] = useState(() =>
    (emissao?.servicos ?? []).map((servico, indice) => ({
      chave: indice,
      pessoaId: servico.pessoaId,
      itemRevisionalId: servico.itemRevisionalId,
      inicio: paraDatetimeLocal(servico.inicio),
      fim: paraDatetimeLocal(servico.fim),
    })),
  );
  // Contador em ref (não em estado): a chave é derivada no próprio momento da
  // inserção, então duas chamadas dentro de um mesmo batch de render nunca
  // podem ler o mesmo valor "antigo" do closure e gerar duas linhas com a
  // mesma `key`.
  const proximaChave = useRef((emissao?.servicos.length ?? 0) + 1);

  const adicionarServico = () => {
    const chave = proximaChave.current;
    proximaChave.current += 1;
    setLinhasServico((atual) => [
      ...atual,
      { chave, pessoaId: "", itemRevisionalId: "", inicio: "", fim: "" },
    ]);
  };

  const removerServico = (chave: number) => {
    setLinhasServico((atual) => atual.filter((linha) => linha.chave !== chave));
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
    if (
      !estado.ok &&
      Array.isArray(estado.error) &&
      estado.error.some((item) => item.field.startsWith("servico-"))
    ) {
      setAba("servico");
    }
  }

  const erro = mensagemDeErro(estado.error);

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

  return (
    <div className="modal-overlay" onClick={onFechar}>
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
            </div>

            <div className={`modal-tab-panel${aba === "itens" ? "" : " hidden"}`}>
              <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                Marque os itens revisionais executados nesta emissão e registre a medição
                realizada.
              </p>
              <div id="emissao-itens-list">
                {linhas.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>
                    {planoId
                      ? "O plano selecionado não tem itens revisionais."
                      : "Selecione um plano revisional na aba Geral."}
                  </p>
                ) : null}
                {linhas.map((linha) => (
                  <LinhaItemEmissaoRow key={`${planoId}-${linha.itemRevisionalId}`} linha={linha} />
                ))}
              </div>
            </div>

            {/* Visibilidade por classe ".hidden" (mesmo padrão dos outros
                painéis), NUNCA desmontando o conteúdo: os inputs das linhas
                de serviço são não-controlados, desmontar o painel ao trocar
                de aba perderia tudo o que foi digitado aqui antes do submit
                (e tiraria os campos do FormData). */}
            <div className={`modal-tab-panel${aba === "servico" ? "" : " hidden"}`}>
              <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                Registre quem executou o serviço, o período trabalhado e o item revisional
                relacionado (aba Itens).
              </p>
              {/* Contagem explícita lida pelo servidor (lerServicos) junto
                  dos campos indexados `servico-{i}-*` — nunca getAll()
                  posicional (Boundaries). */}
              <input type="hidden" name="servicoCount" value={linhasServico.length} />
              <div id="emissao-servico-list">
                {linhasServico.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
                    Nenhum serviço adicionado ainda.
                  </p>
                ) : null}
                {linhasServico.map((linha, indice) => (
                  <LinhaServicoRow
                    key={linha.chave}
                    indice={indice}
                    inicial={linha}
                    pessoas={pessoas}
                    itensRevisionais={itensRevisionais}
                    onRemover={() => removerServico(linha.chave)}
                  />
                ))}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={adicionarServico}
                style={{ marginTop: 10 }}
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
