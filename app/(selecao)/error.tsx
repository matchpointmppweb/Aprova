"use client";

import { ErroDePagina } from "@/src/components/shell/erro-de-pagina";

// A tela de escolha de ambiente falha de um jeito particular: a pessoa está
// autenticada mas ainda não entrou em conta nenhuma, então "voltar ao
// início" cairia na guarda e voltaria para cá. O título diz o que de fato
// aconteceu; as ações continuam as mesmas, e `reset` é o caminho útil aqui.
export default function Erro({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErroDePagina error={error} reset={reset} titulo="Não foi possível carregar seus ambientes" />
  );
}
