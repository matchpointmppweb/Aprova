"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { criarContaAction } from "@/src/server/actions/conta";
import {
  erroDoCampo,
  estadoInicialCriacaoConta,
  mensagemDeErro,
} from "@/src/server/actions/conta-estado";

// Erro do campo, junto do input que o causou — o resumo no topo continua
// existindo, mas com seis campos ele não diz qual deles recusar.
function ErroDoCampo({ mensagem }: { mensagem?: string }) {
  if (!mensagem) return null;
  return <div className="field-error">{mensagem}</div>;
}

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
// (#create-contas). Story 6.7: "Nova conta" provisiona a conta INTEIRA — além
// de nome, CNPJ, plano e status, pede o nome e o e-mail do primeiro
// Administrador, que nasce vinculado na mesma transação e recebe o convite
// para definir a senha. Sem esses dois campos a conta nasceria sem ninguém
// capaz de entrar.
export function LinhaCriacao({
  onFechar,
  onSucesso,
}: {
  onFechar: () => void;
  // O aviso de sucesso (administrador que já tinha acesso à plataforma e não
  // recebeu e-mail) sobe para quem continua montado: esta linha se desmonta no
  // sucesso e não teria onde exibi-lo.
  onSucesso: (aviso?: string) => void;
}) {
  const [estado, formAction] = useActionState(
    criarContaAction,
    estadoInicialCriacaoConta,
  );

  useEffect(() => {
    if (estado.ok) {
      onSucesso(estado.data?.aviso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);
  // React reseta um formulário não controlado depois da action; sem repor os
  // valores, um CNPJ duplicado faria o operador redigitar os seis campos.
  const valores = estado.data?.valores;

  return (
    <tr className="form-row" id="create-contas">
      <td colSpan={6}>
        <div className="form-row-label">Nova conta</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <div className="inline-form">
            <div className="f">
              <label htmlFor="cc-nome">Nome da conta</label>
              <input
                id="cc-nome"
                name="nome"
                type="text"
                placeholder="Razão social"
                required
                defaultValue={valores?.nome ?? ""}
              />
              <ErroDoCampo mensagem={erroDoCampo(estado.error, "nome")} />
            </div>
            <div className="f">
              <label htmlFor="cc-cnpj">CNPJ</label>
              <input
                id="cc-cnpj"
                name="cnpj"
                type="text"
                placeholder="00.000.000/0001-00"
                required
                defaultValue={valores?.cnpj ?? ""}
              />
              <ErroDoCampo mensagem={erroDoCampo(estado.error, "cnpj")} />
            </div>
            <div className="f">
              <label htmlFor="cc-plano">Plano contratado</label>
              <select
                id="cc-plano"
                name="planoContratado"
                required
                defaultValue={valores?.planoContratado || "Essencial"}
              >
                <option value="Essencial">Essencial</option>
                <option value="Corporativo">Corporativo</option>
              </select>
              <ErroDoCampo mensagem={erroDoCampo(estado.error, "planoContratado")} />
            </div>
            <div className="f">
              <label htmlFor="cc-status">Status</label>
              <select
                id="cc-status"
                name="status"
                required
                defaultValue={valores?.status || "Ativa"}
              >
                <option value="Ativa">Ativa</option>
                <option value="PagamentoPendente">Pagamento pendente</option>
              </select>
              <ErroDoCampo mensagem={erroDoCampo(estado.error, "status")} />
            </div>
            <div className="f">
              <label htmlFor="cc-admin-nome">Nome do administrador</label>
              <input
                id="cc-admin-nome"
                name="adminNome"
                type="text"
                placeholder="Nome completo"
                required
                defaultValue={valores?.adminNome ?? ""}
              />
              <ErroDoCampo mensagem={erroDoCampo(estado.error, "adminNome")} />
            </div>
            <div className="f">
              <label htmlFor="cc-admin-email">E-mail do administrador</label>
              <input
                id="cc-admin-email"
                name="adminEmail"
                type="email"
                placeholder="nome@empresa.com.br"
                required
                defaultValue={valores?.adminEmail ?? ""}
              />
              <ErroDoCampo mensagem={erroDoCampo(estado.error, "adminEmail")} />
            </div>
            <Acoes onFechar={onFechar} />
          </div>
        </form>
      </td>
    </tr>
  );
}
