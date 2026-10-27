"use client";

// Único pedaço de cliente da OS impressa: `window.print()` não existe no
// servidor. Tudo o mais da página é Server Component.
//
// Não há biblioteca de PDF no projeto e não se acrescenta uma: a caixa de
// impressão do navegador já oferece "Salvar como PDF", e o CSS `@media print`
// é o que define o resultado nos dois caminhos (papel e PDF). Uma biblioteca
// traria um SEGUNDO layout para manter em sincronia com o primeiro.
export function BotaoImprimir() {
  return (
    // `no-print` tira o próprio botão do papel — ele é controle de tela.
    <button className="btn btn-primary no-print" type="button" onClick={() => window.print()}>
      Imprimir
    </button>
  );
}
