"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";

import { convidarUsuarioAction } from "@/src/server/actions/usuario";
import {
  estadoInicialAcaoUsuario,
  mensagemDeErro,
} from "@/src/server/actions/usuario-estado";
import type { PerfilAcessoOpcao } from "./tipos";

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

// Linha expansível de convite (UX-DR3), portada de Mockup.html
// (#create-usuarios). Diferente do mockup, não tem campo de Status: um
// convite sempre nasce com status ConvitePendente (I/O Matrix da story) —
// quem define o status é o próprio convidado ao logar pela 1ª vez.
export function LinhaConvite({
  perfis,
  onFechar,
  onSucesso,
}: {
  perfis: PerfilAcessoOpcao[];
  onFechar: () => void;
  onSucesso: () => void;
}) {
  const [estado, formAction] = useActionState(
    convidarUsuarioAction,
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
    <tr className="form-row" id="create-usuarios">
      <td colSpan={5}>
        <div className="form-row-label">Convidar usuário</div>
        {erro ? <div className="form-error">{erro}</div> : null}
        <form action={formAction}>
          <div className="inline-form">
            <div className="f">
              <label htmlFor="cv-nome">Nome</label>
              <input id="cv-nome" name="nome" type="text" placeholder="Nome completo" required />
            </div>
            <div className="f">
              <label htmlFor="cv-email">E-mail</label>
              <input
                id="cv-email"
                name="email"
                type="email"
                placeholder="nome@empresa.com.br"
                required
              />
            </div>
            <div className="f">
              <label htmlFor="cv-perfil">Perfil de acesso</label>
              <select id="cv-perfil" name="perfilAcessoId" required defaultValue="">
                <option value="" disabled>
                  Selecione...
                </option>
                {perfis.map((perfil) => (
                  <option key={perfil.id} value={perfil.id}>
                    {perfil.nome}
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
