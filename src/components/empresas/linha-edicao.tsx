"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { editarEmpresaAction } from "@/src/server/actions/empresa";
import {
  estadoInicialAcaoEmpresa,
  mensagemDeErro,
} from "@/src/server/actions/empresa-estado";
import type { EmpresaListagem } from "./tipos";

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
// Mockups/Mochup_atual.html:1153-1163. Sem editor de mapa/campo de status —
// diferente de Locais, Empresa não tem nenhum dos dois (Boundaries/AD-17):
// não há "inativar" nem ação de exclusão separada, só "Editar".
export function LinhaEdicao({
  empresa,
  onFechar,
  onSucesso,
}: {
  empresa: EmpresaListagem;
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    editarEmpresaAction,
    estadoInicialAcaoEmpresa,
  );

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id={`edit-empresas-${empresa.id}`}>
      <td colSpan={6}>
        <div className="form-row-label">Editar empresa · {empresa.razaoSocial}</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <input type="hidden" name="empresaId" value={empresa.id} />
          <div className="inline-form">
            <div className="f">
              <label htmlFor={`ee-razao-social-${empresa.id}`}>Razão social</label>
              <input
                id={`ee-razao-social-${empresa.id}`}
                name="razaoSocial"
                type="text"
                defaultValue={empresa.razaoSocial}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ee-nome-fantasia-${empresa.id}`}>Nome fantasia</label>
              <input
                id={`ee-nome-fantasia-${empresa.id}`}
                name="nomeFantasia"
                type="text"
                defaultValue={empresa.nomeFantasia}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ee-cnpj-${empresa.id}`}>CNPJ</label>
              <input
                id={`ee-cnpj-${empresa.id}`}
                name="cnpj"
                type="text"
                defaultValue={empresa.cnpj ?? ""}
              />
            </div>
            <div className="f">
              <label htmlFor={`ee-cpf-${empresa.id}`}>CPF</label>
              <input
                id={`ee-cpf-${empresa.id}`}
                name="cpf"
                type="text"
                defaultValue={empresa.cpf ?? ""}
              />
            </div>
            <div className="f">
              <label htmlFor={`ee-observacao-${empresa.id}`}>Observação</label>
              <input
                id={`ee-observacao-${empresa.id}`}
                name="observacao"
                type="text"
                defaultValue={empresa.observacao ?? ""}
              />
            </div>
            <Acoes onFechar={onFechar} />
          </div>
        </form>
      </td>
    </tr>
  );
}
