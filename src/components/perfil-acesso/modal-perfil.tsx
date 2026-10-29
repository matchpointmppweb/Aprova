"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { MODULOS_PERFIL, NOME_ADMINISTRADOR } from "@/src/lib/modulos";
import { ACOES, tetoDoAtor as mapaDoTeto } from "@/src/lib/teto-de-permissao";
import {
  criarPerfilAcessoAction,
  editarPerfilAcessoAction,
} from "@/src/server/actions/perfil-acesso";
import {
  estadoInicialAcaoPerfil,
  mensagemDeErro,
} from "@/src/server/actions/perfil-acesso-estado";
import type { PerfilAcessoListagem, PermissaoListagem } from "./tipos";
import { LIMITE_DESCRICAO, LIMITE_NOME } from "@/src/lib/texto";

type AbaModal = "geral" | "permissoes";

// useFormStatus só funciona num componente descendente do <form> (não no
// que o renderiza) — mesmo padrão de LinhaConvite/LinhaEdicao (Story 1.2).
function Acoes({ onFechar }: { onFechar: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="modal-footer">
      <button
        className="btn btn-ghost"
        type="button"
        onClick={onFechar}
        disabled={pending}
      >
        Cancelar
      </button>
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar perfil"}
      </button>
    </div>
  );
}

/// Uma caixa da matriz de permissões.
///
/// Três estados, e a diferença entre os dois últimos é o que impede um
/// apagamento silencioso:
///
/// - DENTRO do teto: caixa normal.
/// - fora do teto e desmarcada: desabilitada. Marcar seria recusado pela
///   Server Action, então a tela nem oferece.
/// - fora do teto mas JÁ MARCADA: desabilitada E acompanhada de um input
///   oculto com o mesmo nome. Uma caixa `disabled` NÃO é enviada pelo
///   navegador — sem o oculto, abrir um perfil mais poderoso e salvar
///   APAGARIA em silêncio toda permissão acima do teto do ator, que é pior
///   do que o problema que o teto resolve.
function CaixaDePermissao({
  modulo,
  acao,
  marcada,
  noTeto,
}: {
  modulo: string;
  acao: string;
  marcada: boolean;
  noTeto: boolean;
}) {
  const nome = `perm-${modulo}-${acao}`;
  const travada = !noTeto;

  return (
    <>
      <input
        type="checkbox"
        name={travada ? undefined : nome}
        defaultChecked={marcada}
        disabled={travada}
        title={
          travada
            ? "Você não pode alterar uma permissão que o seu próprio perfil não tem."
            : undefined
        }
      />
      {travada && marcada ? <input type="hidden" name={nome} value="on" /> : null}
    </>
  );
}

// Modal tabbed Geral/Permissões (UX-DR4), portado de Mockup.html:1334-1361.
// perfil === null -> modo criação; perfil preenchido -> modo edição. Local a
// esta tela (Code Map) — não um primitivo compartilhado ainda, é o único
// modal do app até agora.
export function ModalPerfil({
  perfil,
  tetoDoAtor,
  onFechar,
  onSucesso,
}: {
  perfil: PerfilAcessoListagem | null;
  /// As permissões do próprio usuário: o limite do que ele pode conceder
  /// (src/lib/teto-de-permissao.ts). A Server Action recusa o mesmo.
  tetoDoAtor: PermissaoListagem[];
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const acao = perfil ? editarPerfilAcessoAction : criarPerfilAcessoAction;
  const [estado, formAction] = useActionState(acao, estadoInicialAcaoPerfil);
  const [aba, setAba] = useState<AbaModal>("geral");
  const teto = mapaDoTeto(tetoDoAtor);

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);
  const nomeBloqueado = perfil?.nome === NOME_ADMINISTRADOR;

  const permissaoPorModulo = new Map(
    (perfil?.permissoes ?? []).map((permissao) => [permissao.modulo, permissao]),
  );

  return (
    // `modal-full` (padrão de tela de 20-10-2026): toda tela sobreposta é
    // estendida. DIVERGE DO MOCKUP de propósito — lá este modal (L1939) é a
    // janela reduzida de 760px; a decisão do produto passou a ser o modo
    // estendido para TODAS as telas, não só a de Emissão.
    <div className="modal-overlay modal-full" onClick={onFechar}>
      <div className="modal" onClick={(evento) => evento.stopPropagation()}>
        <div className="modal-header">
          <h2>{perfil ? `Editar perfil · ${perfil.nome}` : "Novo perfil de acesso"}</h2>
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
            className={`modal-tab-btn${aba === "permissoes" ? " active" : ""}`}
            onClick={() => setAba("permissoes")}
          >
            Permissões
          </button>
        </div>

        {erro ? (
          <div className="form-error" style={{ margin: "16px 24px 0" }}>
            {erro}
          </div>
        ) : null}

        <form action={formAction}>
          {perfil ? <input type="hidden" name="perfilAcessoId" value={perfil.id} /> : null}

          <div className="modal-body">
            <div className={`modal-tab-panel${aba === "geral" ? "" : " hidden"}`}>
              <div className="modal-grid">
                <div className="f f-full">
                  <label htmlFor="perfil-nome">Nome do perfil</label>
                  <input
                    id="perfil-nome"
                    name="nome"
                    maxLength={LIMITE_NOME}
                    type="text"
                    placeholder="Ex.: Supervisor de planta"
                    defaultValue={perfil?.nome ?? ""}
                    readOnly={nomeBloqueado}
                    style={
                      nomeBloqueado
                        ? { background: "var(--paper-2)", cursor: "not-allowed" }
                        : undefined
                    }
                    required
                  />
                </div>
                <div className="f f-full">
                  <label htmlFor="perfil-descricao">Descrição</label>
                  <input
                    id="perfil-descricao"
                    name="descricao"
                    maxLength={LIMITE_DESCRICAO}
                    type="text"
                    placeholder="O que esse perfil pode fazer"
                    defaultValue={perfil?.descricao ?? ""}
                  />
                </div>
              </div>
            </div>

            <div className={`modal-tab-panel${aba === "permissoes" ? "" : " hidden"}`}>
              <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                Defina, para cada módulo do sistema, se este perfil pode criar, editar ou
                excluir registros.
              </p>
              <table className="perm-table">
                <thead>
                  <tr>
                    <th>Módulo</th>
                    <th className="perm-check-col">Criar</th>
                    <th className="perm-check-col">Editar</th>
                    <th className="perm-check-col">Excluir</th>
                  </tr>
                </thead>
                <tbody>
                  {MODULOS_PERFIL.map((modulo) => {
                    const atual = permissaoPorModulo.get(modulo.key);
                    const permitido = teto.get(modulo.key);
                    return (
                      <tr key={modulo.key}>
                        <td>{modulo.label}</td>
                        {ACOES.map((acao) => (
                          <td className="perm-check-col" key={acao}>
                            <CaixaDePermissao
                              modulo={modulo.key}
                              acao={acao}
                              marcada={atual?.[acao] ?? false}
                              noTeto={permitido?.[acao] ?? false}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Acoes onFechar={onFechar} />
        </form>
      </div>
    </div>
  );
}
