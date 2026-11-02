// Esqueleto exibido enquanto um Server Component da área carrega
// (diferido da Story 4.3, fechado em 02-11-2026).
//
// O que faltava: nenhuma rota tinha `loading.tsx`. O Painel inicial é a
// primeira página a fazer quatro leituras em paralelo antes de renderizar —
// antes dele a tela era um placeholder estático e instantâneo —, e sem
// `loading.tsx` o Next espera a página inteira terminar para pintar
// qualquer coisa: a navegação parecia travada.
//
// Deliberadamente um ESQUELETO, e não um "Carregando...": o texto isolado
// faz a página saltar quando o conteúdo chega, e não dá nenhuma pista do que
// está vindo. As faixas aqui têm a altura do cabeçalho e de uma tabela, que
// é o que quase toda tela do produto mostra.
//
// `aria-hidden` no desenho e um `role="status"` com o texto ao lado: o
// esqueleto é decoração visual, e quem usa leitor de tela precisa da
// informação, não das faixas.
export function EsqueletoDePagina({ linhas = 6 }: { linhas?: number }) {
  return (
    <section className="page">
      <div className="esqueleto" aria-hidden="true">
        <div className="esq-barra esq-crumb" />
        <div className="esq-cabecalho">
          <div>
            <div className="esq-barra esq-titulo" />
            <div className="esq-barra esq-subtitulo" />
          </div>
          <div className="esq-barra esq-botao" />
        </div>
        <div className="esq-tabela">
          {Array.from({ length: linhas }, (_, indice) => (
            <div className="esq-barra esq-linha" key={indice} />
          ))}
        </div>
      </div>
      <p className="esq-aviso" role="status">
        Carregando…
      </p>
    </section>
  );
}
