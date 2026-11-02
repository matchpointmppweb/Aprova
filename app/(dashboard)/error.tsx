"use client";

import { ErroDePagina } from "@/src/components/shell/erro-de-pagina";

// `error.tsx` tem de ser Client Component (contrato do Next: ele recebe
// `reset`). Vale para todas as páginas desta área, e deixa a casca de pé —
// é o que dá à pessoa um caminho de volta em vez da tela crua do Next.
export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErroDePagina error={error} reset={reset} />;
}
