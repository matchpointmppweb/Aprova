"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { criarEmpresaAction } from "@/src/server/actions/empresa";
import {
  estadoInicialAcaoEmpresa,
  mensagemDeErro,
} from "@/src/server/actions/empresa-estado";

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
// (#create-empresas, linhas 1140-1150). Sem editor de mapa/campo de status —
// diferente de Locais, Empresa não tem nenhum dos dois (Boundaries/AD-17).
export function LinhaCriacao({
  onFechar,
  onSucesso,
}: {
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    criarEmpresaAction,
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
    <tr className="form-row" id="create-empresas">
      <td colSpan={6}>
        <div className="form-row-label">Nova empresa</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <div className="inline-form">
            <div className="f">
              <label htmlFor="ce-razao-social">Razão social</label>
              <input
                id="ce-razao-social"
                name="razaoSocial"
                type="text"
                placeholder="Ex.: Raiz Manutenção Industrial Ltda."
                required
              />
            </div>
            <div className="f">
              <label htmlFor="ce-nome-fantasia">Nome fantasia</label>
              <input
                id="ce-nome-fantasia"
                name="nomeFantasia"
                type="text"
                placeholder="Ex.: Raiz Manutenção"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="ce-cnpj">CNPJ</label>
              <input
                id="ce-cnpj"
                name="cnpj"
                type="text"
                placeholder="00.000.000/0000-00"
              />
            </div>
            <div className="f">
              <label htmlFor="ce-cpf">CPF</label>
              <input
                id="ce-cpf"
                name="cpf"
                type="text"
                placeholder="000.000.000-00 (se aplicável)"
              />
            </div>
            <div className="f">
              <label htmlFor="ce-observacao">Observação</label>
              <input
                id="ce-observacao"
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
