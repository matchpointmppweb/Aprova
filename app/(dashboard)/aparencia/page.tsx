import type { Metadata } from "next";

import { ModoToggle } from "@/src/components/aparencia/modo-toggle";
import { PaletaGrid } from "@/src/components/aparencia/paleta-grid";
import { resolverChavePaleta } from "@/src/lib/paletas";
import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";

export const metadata: Metadata = {
  title: "Aparência — Raiz",
};

// Server Component (Code Map): exigirUsuarioAutenticado() + can() rodam
// aqui, e o resultado de can() é repassado só pra desabilitar a UI de
// <PaletaGrid> (AD-2) — a checagem que realmente vale roda de novo dentro
// de atualizarPaletaAction. O modo claro/escuro nunca passa por aqui
// (AD-11): <ModoToggle> não recebe nenhuma prop de servidor, é 100%
// client-state + localStorage.
export default async function AparenciaPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const podeEditar = await can(usuarioSessao, "editar", "aparencia");
  const paletaAtual = resolverChavePaleta(usuarioSessao.conta.paletaDeCores);

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Configurações / <b>Aparência</b>
      </div>
      <div className="page-head">
        <div>
          <h1>Aparência</h1>
          <p>Teste paletas de cores e o modo de exibição do painel.</p>
        </div>
      </div>

      <div className="settings-section">
        <h3>Modo de exibição</h3>
        <p>Escolha entre o modo claro e o modo escuro.</p>
        <ModoToggle />
      </div>

      <PaletaGrid paletaAtual={paletaAtual} podeEditar={podeEditar} />
    </section>
  );
}
