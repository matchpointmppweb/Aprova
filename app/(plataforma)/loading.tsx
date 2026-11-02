import { EsqueletoDePagina } from "@/src/components/shell/esqueleto-de-pagina";

// Vale para TODAS as páginas desta área: um `loading.tsx` no grupo de rotas
// cobre os filhos, então a casca (sidebar e topbar) continua pintada
// enquanto só o conteúdo carrega. Um arquivo por página seria a mesma coisa
// repetida doze vezes.
export default function Carregando() {
  return <EsqueletoDePagina />;
}
