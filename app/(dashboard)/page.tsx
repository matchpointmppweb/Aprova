import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Início — Raiz",
};

// Painel inicial (CAP-6, com KPIs e listas) é escopo da Story 4.3 — aqui só
// a casca (topbar/sidebar/breadcrumb) desta story, com um placeholder mínimo
// da página de destino pós-login.
export default function InicioPage() {
  return (
    <section className="page">
      <div className="crumb">
        Raiz / <b>Início</b>
      </div>
      <div className="page-head">
        <div>
          <h1>Bem-vindo ao Raiz</h1>
          <p>O painel inicial com seus indicadores chega em uma próxima etapa.</p>
        </div>
      </div>
    </section>
  );
}
