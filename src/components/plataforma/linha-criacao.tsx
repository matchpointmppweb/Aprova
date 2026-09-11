"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { criarContaAction } from "@/src/server/actions/conta";
import {
  estadoInicialAcaoConta,
  mensagemDeErro,
} from "@/src/server/actions/conta-estado";

// useFormStatus só funciona num componente descendente do <form> (não no
// que o renderiza) — por isso Salvar e Cancelar são agrupados aqui: o
// Cancelar também precisa ficar desabilitado durante o submit, senão dá pra
// clicar nele, desmontar a linha e perder a visibilidade do resultado do
// save em andamento. Mesmo padrão de src/components/usuarios/linha-convite.tsx.
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

// Linha expansível de criação (UX-DR2/UX-DR3), portada de Mockup.html:1093
// (#create-contas). "Nova conta" cria só a linha de Conta — nome, CNPJ,
// plano, status — fiel ao mockup (Decisão confirmada no Intent): sem campo
// de usuário/perfil aqui.
export function LinhaCriacao({
  onFechar,
  onSucesso,
}: {
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(criarContaAction, estadoInicialAcaoConta);

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id="create-contas">
      <td colSpan={6}>
        <div className="form-row-label">Nova conta</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <div className="inline-form">
            <div className="f">
              <label htmlFor="cc-nome">Nome da conta</label>
              <input id="cc-nome" name="nome" type="text" placeholder="Razão social" required />
            </div>
            <div className="f">
              <label htmlFor="cc-cnpj">CNPJ</label>
              <input
                id="cc-cnpj"
                name="cnpj"
                type="text"
                placeholder="00.000.000/0001-00"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="cc-plano">Plano contratado</label>
              <select id="cc-plano" name="planoContratado" required defaultValue="Essencial">
                <option value="Essencial">Essencial</option>
                <option value="Corporativo">Corporativo</option>
              </select>
            </div>
            <div className="f">
              <label htmlFor="cc-status">Status</label>
              <select id="cc-status" name="status" required defaultValue="Ativa">
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
