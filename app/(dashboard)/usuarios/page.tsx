import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaUsuarios } from "@/src/components/usuarios/tabela-usuarios";
import { listarPerfisAcesso } from "@/src/server/repositories/perfil-acesso";
import { listarUsuarios } from "@/src/server/repositories/usuario";

export const metadata: Metadata = {
  title: "Usuários — Raiz",
};

// Server Component (CAP-7): busca listarUsuarios + listarPerfisAcesso +
// can(), e repassa para a tabela client-side. can() roda aqui, no servidor,
// e a UI usa o mesmo resultado para esconder/desabilitar convidar/editar —
// nunca uma checagem paralela (AD-2).
export default async function UsuariosPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [usuarios, perfis, podeCriar, podeEditar] = await Promise.all([
    listarUsuarios(usuarioSessao.contaId),
    listarPerfisAcesso(usuarioSessao.contaId),
    can(usuarioSessao, "criar", "usuarios"),
    can(usuarioSessao, "editar", "usuarios"),
  ]);

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Configurações / <b>Usuários</b>
      </div>

      <TabelaUsuarios
        usuarios={usuarios}
        perfis={perfis}
        podeCriar={podeCriar}
        podeEditar={podeEditar}
      />
    </section>
  );
}
