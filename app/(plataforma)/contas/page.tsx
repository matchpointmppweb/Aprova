import type { Metadata } from "next";

import { TabelaContas } from "@/src/components/plataforma/tabela-contas";
import { listarContas } from "@/src/server/repositories/conta";

export const metadata: Metadata = {
  title: "Contas — Raiz",
};

// Server Component (CAP-8): listarContas() sem can() — o gate desta área
// inteira já é exigirOperadorDePlataforma(), aplicado em
// app/(plataforma)/layout.tsx antes de chegar aqui (AD-13, nunca
// can()/PerfilAcesso para esta área).
export default async function ContasPage() {
  const contas = await listarContas();

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Configurações / <b>Contas</b>
      </div>

      <TabelaContas contas={contas} />
    </section>
  );
}
