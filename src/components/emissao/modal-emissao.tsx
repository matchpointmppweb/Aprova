"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { criarEmissaoAction, editarEmissaoAction } from "@/src/server/actions/emissao";
import { estadoInicialAcaoEmissao, mensagemDeErro } from "@/src/server/actions/emissao-estado";
import type {
  AtivoOpcao,
  EmissaoListagem,
  ItemRevisionalOpcao,
  PlanoOpcao,
  UsuarioOpcao,
} from "./tipos";

type AbaModal = "geral" | "itens";

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

// Modal tabbed Geral/Itens, clonando o padrão de modal-plano.tsx (Code Map).
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
  onFechar,
  onSucesso,
}: {
  emissao: EmissaoListagem | null;
  ativos: AtivoOpcao[];
  planos: PlanoOpcao[];
  usuarios: UsuarioOpcao[];
  itensRevisionais: ItemRevisionalOpcao[];
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const acao = emissao ? editarEmissaoAction : criarEmissaoAction;
  const [estado, formAction] = useActionState(acao, estadoInicialAcaoEmissao);
  const [aba, setAba] = useState<AbaModal>("geral");
  const [ativoId, setAtivoId] = useState(emissao?.ativoId ?? "");
  const [planoId, setPlanoId] = useState(emissao?.planoId ?? "");
  const [responsavelId, setResponsavelId] = useState(emissao?.responsavelId ?? "");

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

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
        </div>

        {erro ? (
          <div className="form-error" style={{ margin: "16px 24px 0" }}>
            {erro}
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
          </div>

          <Acoes onFechar={onFechar} />
        </form>
      </div>
    </div>
  );
}
