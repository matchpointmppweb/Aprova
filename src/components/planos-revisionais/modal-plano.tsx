"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { criarPlanoAction, editarPlanoAction } from "@/src/server/actions/plano";
import { estadoInicialAcaoPlano, mensagemDeErro } from "@/src/server/actions/plano-estado";
import type {
  AtivoOpcao,
  EmpresaOpcao,
  ItemRevisionalOpcao,
  PlanoListagem,
  TipoAtivoOpcao,
  UsuarioOpcao,
} from "./tipos";

type AbaModal = "geral" | "itens";
type Vinculo = "ativo" | "tipo" | "empresa";

// useFormStatus só funciona num componente descendente do <form> (não no
// que o renderiza) — mesmo padrão de Acoes em
// src/components/perfil-acesso/modal-perfil.tsx.
function Acoes({ onFechar }: { onFechar: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="modal-footer">
      <button className="btn btn-ghost" type="button" onClick={onFechar} disabled={pending}>
        Cancelar
      </button>
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar plano"}
      </button>
    </div>
  );
}

const CONTROLES: {
  key: "dias" | "km" | "horas";
  label: string;
  padrao: (item: ItemRevisionalOpcao) => number | null;
  campoOverride: (item: ItemRevisionalOpcao) => string;
}[] = [
  {
    key: "dias",
    label: "A cada (dias)",
    padrao: (item) => item.diasPadrao,
    campoOverride: (item) => `itemDias-${item.id}`,
  },
  {
    key: "km",
    label: "A cada (km)",
    padrao: (item) => item.kmPadrao,
    campoOverride: (item) => `itemKm-${item.id}`,
  },
  {
    key: "horas",
    label: "A cada (horas)",
    padrao: (item) => item.horasPadrao,
    campoOverride: (item) => `itemHoras-${item.id}`,
  },
];

// Uma linha por controle que o item já tem selecionado (Boundaries: nunca
// dá pra inventar um controle que o item não define) — cada uma vira um
// campo numérico de override, desabilitado até o checkbox do item ser
// marcado (mesmo espírito visual de Mockup.html:1503-1533).
function controlesDoItem(item: ItemRevisionalOpcao) {
  return CONTROLES.filter((controle) => controle.padrao(item) !== null);
}

function overrideExistente(
  plano: PlanoListagem | null,
  itemId: string,
  campo: "diasOverride" | "kmOverride" | "horasOverride",
) {
  return plano?.itens.find((item) => item.itemRevisionalId === itemId)?.[campo] ?? null;
}

// Modal tabbed Geral/Itens revisionais (primeiro modal com abas do produto
// reaproveitando o padrão de src/components/perfil-acesso/modal-perfil.tsx,
// Story 1.3), portado de Mockup.html:1254-1290/1503-1548. plano === null ->
// modo criação; plano preenchido -> modo edição. SEM campo de Status
// editável (Boundaries: a versão real não tem esse campo em lugar nenhum —
// o `<select>` de Status do mockup era só um artefato estático do
// protótipo).
export function ModalPlano({
  plano,
  ativos,
  tiposAtivo,
  empresas,
  usuarios,
  itensRevisionais,
  onFechar,
  onSucesso,
}: {
  plano: PlanoListagem | null;
  ativos: AtivoOpcao[];
  tiposAtivo: TipoAtivoOpcao[];
  empresas: EmpresaOpcao[];
  usuarios: UsuarioOpcao[];
  itensRevisionais: ItemRevisionalOpcao[];
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const acao = plano ? editarPlanoAction : criarPlanoAction;
  const [estado, formAction] = useActionState(acao, estadoInicialAcaoPlano);
  const [aba, setAba] = useState<AbaModal>("geral");
  const [vinculo, setVinculo] = useState<Vinculo>(
    plano?.tipoAtivoId ? "tipo" : plano?.empresaId ? "empresa" : "ativo",
  );
  // Estado controlado por tipo de vínculo, independente do outro — alternar
  // o radio nunca descarta uma escolha já feita do lado que fica "escondido"
  // (achado de revisão: um <select> não-controlado com key={vinculo} perdia
  // silenciosamente a seleção ao trocar de radio e voltar).
  const [ativoIdSelecionado, setAtivoIdSelecionado] = useState(plano?.ativoId ?? "");
  const [tipoAtivoIdSelecionado, setTipoAtivoIdSelecionado] = useState(plano?.tipoAtivoId ?? "");
  const [empresaIdSelecionado, setEmpresaIdSelecionado] = useState(plano?.empresaId ?? "");

  const selecaoInicial = useMemo(
    () => new Set((plano?.itens ?? []).map((item) => item.itemRevisionalId)),
    [plano],
  );
  const [selecionados, setSelecionados] = useState<Set<string>>(selecaoInicial);

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  // Picker mostra só itens Ativos da conta, mais qualquer item já
  // selecionado neste plano mesmo que tenha sido arquivado depois (edição
  // não pode perder silenciosamente uma linha existente).
  const itensExibidos = itensRevisionais.filter(
    (item) => item.status === "Ativo" || selecaoInicial.has(item.id),
  );

  // Só ativos/tipos com status "Ativo" ficam selecionáveis para um vínculo
  // novo — mesmo critério já usado pelo picker de Itens revisionais
  // (itensExibidos) neste mesmo arquivo. O vínculo atual do plano em edição
  // sempre aparece na lista mesmo que tenha sido desativado depois (edição
  // não pode perder silenciosamente o vínculo existente).
  //
  // Empresa é a exceção e não por esquecimento: ela não tem coluna de status
  // (AD-17), então não há o que filtrar nem o que preservar.
  //
  // Os três vínculos viram UMA tabela em vez de um ternário aninhado: com
  // dois lados o ternário ainda se lia, com três ele esconderia qual campo
  // vai no `name` do <select> — e é justamente esse nome que a Server Action
  // usa para decidir o XOR.
  const configuracaoDoVinculo = {
    ativo: {
      campo: "ativoId",
      rotulo: "Selecione o ativo",
      valor: ativoIdSelecionado,
      selecionar: setAtivoIdSelecionado,
      opcoes: ativos
        .filter((opcao) => opcao.status === "Ativo" || opcao.id === plano?.ativoId)
        .map((opcao) => ({ id: opcao.id, rotulo: opcao.nome })),
    },
    tipo: {
      campo: "tipoAtivoId",
      rotulo: "Selecione o tipo de ativo",
      valor: tipoAtivoIdSelecionado,
      selecionar: setTipoAtivoIdSelecionado,
      opcoes: tiposAtivo
        .filter((opcao) => opcao.status === "Ativo" || opcao.id === plano?.tipoAtivoId)
        .map((opcao) => ({ id: opcao.id, rotulo: opcao.nome })),
    },
    empresa: {
      campo: "empresaId",
      rotulo: "Selecione a empresa",
      valor: empresaIdSelecionado,
      selecionar: setEmpresaIdSelecionado,
      opcoes: empresas.map((opcao) => ({ id: opcao.id, rotulo: opcao.razaoSocial })),
    },
  }[vinculo];

  function alternarItem(itemId: string, marcado: boolean) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (marcado) proximo.add(itemId);
      else proximo.delete(itemId);
      return proximo;
    });
  }

  return (
    // `modal-full` (padrão de tela de 20-10-2026): toda tela sobreposta é
    // estendida. DIVERGE DO MOCKUP de propósito — lá este modal (L1819) é a
    // janela reduzida de 760px; a decisão do produto passou a ser o modo
    // estendido para TODAS as telas, não só a de Emissão.
    <div className="modal-overlay modal-full" onClick={onFechar}>
      <div className="modal" onClick={(evento) => evento.stopPropagation()}>
        <div className="modal-header">
          <h2>{plano ? `Editar plano · ${plano.nome}` : "Novo plano revisional"}</h2>
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
            Itens revisionais
          </button>
        </div>

        {erro ? (
          <div className="form-error" style={{ margin: "16px 24px 0" }}>
            {erro}
          </div>
        ) : null}

        <form action={formAction}>
          {plano ? (
            <>
              <input type="hidden" name="planoId" value={plano.id} />
              <input type="hidden" name="updatedAt" value={plano.updatedAt.toISOString()} />
            </>
          ) : null}

          <div className="modal-body">
            <div className={`modal-tab-panel${aba === "geral" ? "" : " hidden"}`}>
              <div className="modal-grid">
                <div className="f f-full">
                  <label htmlFor="plano-nome">Nome do plano</label>
                  <input
                    id="plano-nome"
                    name="nome"
                    type="text"
                    placeholder="Ex.: Inspeção trimestral"
                    defaultValue={plano?.nome ?? ""}
                    required
                  />
                </div>
                <div className="f f-full">
                  <label>Vinculado a</label>
                  <div className="radio-row">
                    <label>
                      <input
                        type="radio"
                        name="vinculo"
                        value="ativo"
                        checked={vinculo === "ativo"}
                        onChange={() => setVinculo("ativo")}
                      />
                      Ativo específico
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="vinculo"
                        value="tipo"
                        checked={vinculo === "tipo"}
                        onChange={() => setVinculo("tipo")}
                      />
                      Tipo de ativo
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="vinculo"
                        value="empresa"
                        checked={vinculo === "empresa"}
                        onChange={() => setVinculo("empresa")}
                      />
                      Empresa
                    </label>
                  </div>
                  <select
                    name={configuracaoDoVinculo.campo}
                    required
                    value={configuracaoDoVinculo.valor}
                    onChange={(evento) => configuracaoDoVinculo.selecionar(evento.target.value)}
                  >
                    <option value="" disabled>
                      {configuracaoDoVinculo.rotulo}
                    </option>
                    {configuracaoDoVinculo.opcoes.map((opcao) => (
                      <option key={opcao.id} value={opcao.id}>
                        {opcao.rotulo}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="f f-full">
                  <label htmlFor="plano-responsavel">Responsável</label>
                  <select
                    id="plano-responsavel"
                    name="responsavelId"
                    required
                    defaultValue={plano?.responsavelId ?? ""}
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
              </div>
            </div>

            <div className={`modal-tab-panel${aba === "itens" ? "" : " hidden"}`}>
              <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                Selecione os itens revisionais que fazem parte deste plano. Ao marcar um item,
                você pode ajustar a medição específica para este plano.
              </p>
              <div id="plano-itens-list">
                {itensExibidos.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>
                    Nenhum item revisional cadastrado. Cadastre um item revisional antes de criar
                    um plano.
                  </p>
                ) : null}
                {itensExibidos.map((item) => {
                  const marcado = selecionados.has(item.id);
                  const controles = controlesDoItem(item);
                  return (
                    <div className="item-row" key={item.id}>
                      <label className="item-check">
                        <input
                          type="checkbox"
                          name={`itemSelecionado-${item.id}`}
                          checked={marcado}
                          onChange={(evento) => alternarItem(item.id, evento.target.checked)}
                        />
                        <span>{item.nome}</span>
                      </label>
                      <div className="item-badges">
                        {controles.map((controle) => (
                          <span className="tag tag-neutral" key={controle.key}>
                            {controle.key === "dias"
                              ? "Dias"
                              : controle.key === "km"
                                ? "Km"
                                : "Horas"}
                          </span>
                        ))}
                      </div>
                      <div className="item-fields">
                        {controles.map((controle) => {
                          const overrideAtual =
                            controle.key === "dias"
                              ? overrideExistente(plano, item.id, "diasOverride")
                              : controle.key === "km"
                                ? overrideExistente(plano, item.id, "kmOverride")
                                : overrideExistente(plano, item.id, "horasOverride");
                          const valorInicial = overrideAtual ?? controle.padrao(item) ?? "";
                          return (
                            <div className="f" key={controle.key}>
                              <label htmlFor={controle.campoOverride(item)}>{controle.label}</label>
                              <input
                                id={controle.campoOverride(item)}
                                name={controle.campoOverride(item)}
                                type="number"
                                min={1}
                                defaultValue={valorInicial}
                                disabled={!marcado}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <Acoes onFechar={onFechar} />
        </form>
      </div>
    </div>
  );
}
