"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { editarPessoaAction } from "@/src/server/actions/pessoa";
import {
  estadoInicialAcaoPessoa,
  mensagemDeErro,
} from "@/src/server/actions/pessoa-estado";
import type { OpcaoReferencia, PessoaListagem } from "./tipos";

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

// Linha expansível de edição (UX-DR3), portada de
// Mockups/Mochup_atual.html:1368-1378. Sem editor de mapa/campo de status —
// diferente de Locais, Pessoa não tem nenhum dos dois (Boundaries/
// AD-17/AD-18): não há "inativar" nem ação de exclusão separada, só
// "Editar". Um Cargo/Função já inativado (Story 5.3) continua aparecendo
// selecionado normalmente se for o vínculo atual da pessoa — os demais
// inativados ficam de fora das opções (I/O Matrix: "Cargo/Função arquivado
// ainda usável").
export function LinhaEdicao({
  pessoa,
  cargos,
  funcoes,
  onFechar,
  onSucesso,
}: {
  pessoa: PessoaListagem;
  cargos: OpcaoReferencia[];
  funcoes: OpcaoReferencia[];
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    editarPessoaAction,
    estadoInicialAcaoPessoa,
  );

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  // Ativos, mais o vínculo atual mesmo que já tenha sido inativado — assim
  // editar a observação de uma pessoa não força trocar o cargo dela só
  // porque aquele cargo saiu de circulação (I/O Matrix: "Cargo/Função
  // arquivado ainda usável"). Mesmo filtro de modal-plano.tsx/
  // modal-emissao.tsx.
  const cargosDisponiveis = cargos.filter(
    (cargo) => cargo.status === "Ativo" || cargo.id === pessoa.cargoId,
  );
  const funcoesDisponiveis = funcoes.filter(
    (funcao) => funcao.status === "Ativo" || funcao.id === pessoa.funcaoId,
  );

  return (
    <tr className="form-row" id={`edit-pessoas-${pessoa.id}`}>
      <td colSpan={6}>
        <div className="form-row-label">Editar pessoa · {pessoa.nome}</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <input type="hidden" name="pessoaId" value={pessoa.id} />
          <div className="inline-form">
            <div className="f">
              <label htmlFor={`ep-nome-${pessoa.id}`}>Nome</label>
              <input
                id={`ep-nome-${pessoa.id}`}
                name="nome"
                type="text"
                defaultValue={pessoa.nome}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ep-cpf-${pessoa.id}`}>CPF</label>
              <input
                id={`ep-cpf-${pessoa.id}`}
                name="cpf"
                type="text"
                defaultValue={pessoa.cpf}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ep-cargo-${pessoa.id}`}>Cargo</label>
              <select
                id={`ep-cargo-${pessoa.id}`}
                name="cargoId"
                required
                defaultValue={pessoa.cargoId}
              >
                {cargosDisponiveis.map((cargo) => (
                  <option key={cargo.id} value={cargo.id}>
                    {cargo.descricao}
                  </option>
                ))}
              </select>
            </div>
            <div className="f">
              <label htmlFor={`ep-funcao-${pessoa.id}`}>Função</label>
              <select
                id={`ep-funcao-${pessoa.id}`}
                name="funcaoId"
                required
                defaultValue={pessoa.funcaoId}
              >
                {funcoesDisponiveis.map((funcao) => (
                  <option key={funcao.id} value={funcao.id}>
                    {funcao.descricao}
                  </option>
                ))}
              </select>
            </div>
            <div className="f">
              <label htmlFor={`ep-observacao-${pessoa.id}`}>Observação</label>
              <input
                id={`ep-observacao-${pessoa.id}`}
                name="observacao"
                type="text"
                defaultValue={pessoa.observacao ?? ""}
              />
            </div>
            <Acoes onFechar={onFechar} />
          </div>
        </form>
      </td>
    </tr>
  );
}
