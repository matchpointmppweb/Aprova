"use client";

// Fronteira de erro das áreas do painel (diferido da Story 4.3, fechado em
// 02-11-2026).
//
// O que faltava: nenhuma rota tinha `error.tsx`, então uma falha em qualquer
// uma das leituras de uma página virava a tela de erro crua do Next — sem
// casca, sem explicação e sem caminho de volta. O Painel inicial fez isso
// aparecer pela primeira vez, porque é a tela que faz quatro leituras antes
// de renderizar.
//
// NÃO mostra `error.message`. Em produção o Next já troca a mensagem de
// servidor por um digest, mas em desenvolvimento ela passa — e exibi-la aqui
// criaria o hábito de uma tela que às vezes vaza detalhe interno (Boundaries:
// "nunca expõe detalhe de constraint/banco"). O `digest` aparece porque é
// exatamente o que liga esta tela à linha de `[raiz:falha]` no log do
// servidor (src/server/log.ts): é o que torna o relato da pessoa
// investigável.
export function ErroDePagina({
  error,
  reset,
  titulo = "Não foi possível carregar esta tela",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  titulo?: string;
}) {
  return (
    <section className="page">
      <div className="erro-pagina" role="alert">
        <h1>{titulo}</h1>
        <p>
          A falha foi registrada. Tente de novo — se continuar, o código abaixo identifica o que
          aconteceu.
        </p>
        {/* Só quando existe: um código vazio na tela é pior do que nenhum,
            porque a pessoa tenta relatá-lo. */}
        {error.digest ? (
          <p className="erro-digest">
            Código: <code>{error.digest}</code>
          </p>
        ) : null}
        <div className="erro-acoes">
          {/* `reset` re-renderiza o segmento sem recarregar a página inteira,
              então uma falha passageira (um timeout do banco) se resolve sem
              a pessoa perder onde estava. */}
          <button className="btn btn-primary" type="button" onClick={reset}>
            Tentar de novo
          </button>
          {/* Âncora de verdade, e não <Link>: se o erro veio do próprio
              roteamento, a navegação do cliente falharia junto e o botão não
              levaria a lugar nenhum. Aqui o recarregamento completo é o
              ponto, e é por isso que a regra do lint é desligada nesta linha
              — não por descuido. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a className="btn btn-ghost" href="/">
            Voltar ao início
          </a>
        </div>
      </div>
    </section>
  );
}
