import type { Metadata } from "next";

import { can } from "@/src/server/auth/can";
import { exigirUsuarioAutenticado } from "@/src/server/auth/sessao";
import { TabelaLocais } from "@/src/components/locais/tabela-locais";
import type { LocalListagem } from "@/src/components/locais/tipos";
import type { PontoMapa } from "@/src/components/locais/mapa-editor";
import { listarLocais } from "@/src/server/repositories/local";

export const metadata: Metadata = {
  title: "Locais — Raiz",
};

// Server Component (Story 5.1): busca listarLocais + can(), e repassa para a
// tabela client-side. can() roda aqui, no servidor, e a UI usa o mesmo
// resultado para esconder/desabilitar criar/editar — nunca uma checagem
// paralela (AD-2). Mesmo padrão de app/(dashboard)/tipos/page.tsx.
export default async function LocaisPage() {
  const usuarioSessao = await exigirUsuarioAutenticado();

  const [locais, podeCriar, podeEditar] = await Promise.all([
    listarLocais(usuarioSessao.contaId),
    can(usuarioSessao, "criar", "locais"),
    can(usuarioSessao, "editar", "locais"),
  ]);

  // areaPoligono vem do banco como Prisma.JsonValue — a forma real gravada
  // é sempre {x,y}[] | null (Server Actions só persistem nesse shape,
  // Code Map), então o cast aqui é seguro.
  const locaisListagem: LocalListagem[] = locais.map((local) => ({
    id: local.id,
    nome: local.nome,
    endereco: local.endereco,
    areaPoligono: local.areaPoligono as PontoMapa[] | null,
    status: local.status,
  }));

  return (
    <section className="page">
      <div className="crumb">
        Raiz / Cadastros / <b>Locais</b>
      </div>

      <TabelaLocais locais={locaisListagem} podeCriar={podeCriar} podeEditar={podeEditar} />
    </section>
  );
}
