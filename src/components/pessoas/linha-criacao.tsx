"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { criarPessoaAction } from "@/src/server/actions/pessoa";
import {
  estadoInicialAcaoPessoa,
  mensagemDeErro,
} from "@/src/server/actions/pessoa-estado";
import type { OpcaoReferencia } from "./tipos";

// useFormStatus só funciona num componente descendente do <form> (não no
// que o renderiza) — por isso Salvar e Cancelar são agrupados aqui: o
// Cancelar também precisa ficar desabilitado durante o submit, senão dá pra
// clicar nele, desmontar a linha e perder a visibilidade do resultado do
// save em andamento.
function Acoes({ onFechar }: { onFechar: () => void }) {
  const { pending } = useFormStatus();
  return (
    <div className="actions">
      <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar"}
      </button>
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={onFechar}
        disabled={pending}
      >
        Cancelar
      </button>
    </div>
  );
}

// Linha expansível de criação (UX-DR3), portada de Mockups/Mochup_atual.html
// (#create-pessoas, linhas 1355-1365). Sem editor de mapa/campo de status —
// diferente de Locais, Pessoa não tem nenhum dos dois (Boundaries/
// AD-17/AD-18). Cargo/Função são <select> alimentados pelas listagens
// carregadas pela página (referência por FK, nunca texto livre).
export function LinhaCriacao({
  cargos,
  funcoes,
  onFechar,
  onSucesso,
}: {
  cargos: OpcaoReferencia[];
  funcoes: OpcaoReferencia[];
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    criarPessoaAction,
    estadoInicialAcaoPessoa,
  );

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  // Só Cargo/Função ativos podem ser escolhidos numa Pessoa nova — inativar
  // (Story 5.3) existe justamente para tirar a opção de circulação. Mesmo
  // filtro de modal-plano.tsx/modal-emissao.tsx; a edição é que preserva um
  // vínculo já existente com um registro inativado.
  const cargosAtivos = cargos.filter((cargo) => cargo.status === "Ativo");
  const funcoesAtivas = funcoes.filter((funcao) => funcao.status === "Ativo");

  return (
    <tr className="form-row" id="create-pessoas">
      <td colSpan={6}>
        <div className="form-row-label">Nova pessoa</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <div className="inline-form">
            <div className="f">
              <label htmlFor="cp-nome">Nome</label>
              <input
                id="cp-nome"
                name="nome"
                type="text"
                placeholder="Nome completo"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="cp-cpf">CPF</label>
              <input
                id="cp-cpf"
                name="cpf"
                type="text"
                placeholder="000.000.000-00"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="cp-cargo">Cargo</label>
              <select id="cp-cargo" name="cargoId" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {cargosAtivos.map((cargo) => (
                  <option key={cargo.id} value={cargo.id}>
                    {cargo.descricao}
                  </option>
                ))}
              </select>
            </div>
            <div className="f">
              <label htmlFor="cp-funcao">Função</label>
              <select id="cp-funcao" name="funcaoId" required defaultValue="">
                <option value="" disabled>
                  Selecione
                </option>
                {funcoesAtivas.map((funcao) => (
                  <option key={funcao.id} value={funcao.id}>
                    {funcao.descricao}
                  </option>
                ))}
              </select>
            </div>
            <div className="f">
              <label htmlFor="cp-observacao">Observação</label>
              <input
                id="cp-observacao"
                name="observacao"
                type="text"
                placeholder="Observações gerais"
              />
            </div>
            <Acoes onFechar={onFechar} />
          </div>
        </form>
      </td>
    </tr>
  );
}
