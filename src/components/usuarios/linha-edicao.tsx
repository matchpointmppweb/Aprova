"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { editarUsuarioAction } from "@/src/server/actions/usuario";
import {
  estadoInicialAcaoUsuario,
  mensagemDeErro,
} from "@/src/server/actions/usuario-estado";
import type { PerfilAcessoOpcao, UsuarioListagem } from "./tipos";

// "Convite pendente" é status system-managed (definido na criação do
// convite, limpo automaticamente no 1º login) — nunca uma opção que um
// admin escolhe manualmente aqui.
const OPCOES_STATUS: { value: string; label: string }[] = [
  { value: "Ativo", label: "Ativo" },
  { value: "Inativo", label: "Inativo" },
];

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

// Linha expansível de edição (UX-DR3), portada de Mockup.html
// (#edit-usuarios-N). A guarda de "último Administrador ativo" (Decisão
// confirmada no Intent) é checada só no servidor — esta linha não tenta
// prever o resultado no cliente, só exibe o erro claro que a Server Action
// devolve se a ação for recusada.
export function LinhaEdicao({
  usuario,
  perfis,
  onFechar,
  onSucesso,
}: {
  usuario: UsuarioListagem;
  perfis: PerfilAcessoOpcao[];
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    editarUsuarioAction,
    estadoInicialAcaoUsuario,
  );

  useEffect(() => {
    if (estado.ok) {
      onSucesso();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);

  const erro = mensagemDeErro(estado.error);

  return (
    <tr className="form-row" id={`edit-usuarios-${usuario.id}`}>
      <td colSpan={5}>
        <div className="form-row-label">Editar usuário · {usuario.nome}</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <input type="hidden" name="usuarioId" value={usuario.id} />
          <div className="inline-form">
            <div className="f">
              <label htmlFor={`ed-nome-${usuario.id}`}>Nome</label>
              <input
                id={`ed-nome-${usuario.id}`}
                name="nome"
                type="text"
                defaultValue={usuario.nome}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ed-email-${usuario.id}`}>E-mail</label>
              <input
                id={`ed-email-${usuario.id}`}
                name="email"
                type="email"
                defaultValue={usuario.email}
                required
              />
            </div>
            <div className="f">
              <label htmlFor={`ed-perfil-${usuario.id}`}>Perfil de acesso</label>
              <select
                id={`ed-perfil-${usuario.id}`}
                name="perfilAcessoId"
                required
                defaultValue={usuario.perfilAcesso.id}
              >
                {perfis.map((perfil) => (
                  <option key={perfil.id} value={perfil.id}>
                    {perfil.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="f">
              <label htmlFor={`ed-status-${usuario.id}`}>Status</label>
              <select
                id={`ed-status-${usuario.id}`}
                name="status"
                required
                defaultValue={usuario.status}
              >
                {OPCOES_STATUS.map((opcao) => (
                  <option key={opcao.value} value={opcao.value}>
                    {opcao.label}
                  </option>
                ))}
              </select>
            </div>
            <Acoes onFechar={onFechar} />
          </div>
        </form>
      </td>
    </tr>
  );
}
