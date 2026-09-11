"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { editarContaAction } from "@/src/server/actions/conta";
import {
  estadoInicialAcaoConta,
  mensagemDeErro,
} from "@/src/server/actions/conta-estado";
import type { ContaListagem } from "./tipos";

// useFormStatus só funciona num componente descendente do <form> (não no
// que o renderiza) — por isso Salvar e Cancelar são agrupados aqui. Mesmo
// padrão de src/components/usuarios/linha-edicao.tsx.
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

// Linha expansível de edição (UX-DR2/UX-DR3), portada de Mockup.html
// (#edit-contas-N). Editar o status para "Pagamento pendente" não precisa de
// nenhum código adicional aqui: o bloqueio de login dos usuários dessa conta
// já é aplicado por entrarAction/exigirUsuarioAutenticado (I/O Matrix da
// story) a partir do momento em que a Conta grava esse status.
export function LinhaEdicao({
  conta,
  onFechar,
  onSucesso,
}: {
  conta: ContaListagem;
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(editarContaAction, estadoInicialAcaoConta);

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id={`edit-contas-${conta.id}`}>
      <td colSpan={6}>
        <div className="form-row-label">Editar conta · {conta.nome}</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <input type="hidden" name="contaId" value={conta.id} />
          <div className="inline-form">
            <div className="f">
              <label htmlFor={`ec-nome-${conta.id}`}>Nome da conta</label>
              <input
                id={`ec-nome-${conta.id}`}
                name="nome"
                type="text"
                defaultValue={conta.nome}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ec-cnpj-${conta.id}`}>CNPJ</label>
              <input
                id={`ec-cnpj-${conta.id}`}
                name="cnpj"
                type="text"
                defaultValue={conta.cnpj}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ec-plano-${conta.id}`}>Plano contratado</label>
              <select
                id={`ec-plano-${conta.id}`}
                name="planoContratado"
                required
                defaultValue={conta.planoContratado}
              >
                <option value="Essencial">Essencial</option>
                <option value="Corporativo">Corporativo</option>
              </select>
            </div>
            <div className="f">
              <label htmlFor={`ec-status-${conta.id}`}>Status</label>
              <select
                id={`ec-status-${conta.id}`}
                name="status"
                required
                defaultValue={conta.status}
              >
                <option value="Ativa">Ativa</option>
                <option value="PagamentoPendente">Pagamento pendente</option>
              </select>
            </div>
            <Acoes onFechar={onFechar} />
          </div>
        </form>
      </td>
    </tr>
  );
}
