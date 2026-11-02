"use client";

// Último recurso: falha no PRÓPRIO layout raiz, onde nenhum `error.tsx` de
// área é alcançado (02-11-2026).
//
// `global-error.tsx` SUBSTITUI o layout raiz, então precisa das próprias
// tags <html> e <body> — e, pelo mesmo motivo, não pode contar com
// `globals.css` nem com as variáveis de cor do tema. Os estilos aqui são
// inline de propósito: uma tela que só aparece quando tudo o mais falhou não
// pode depender de mais nada carregar.
//
// Sem `reset` como ação principal: se o layout raiz quebrou, re-renderizar o
// mesmo segmento tende a quebrar igual. Recarregar é o que tem chance.
export default function ErroGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F7F6F1",
          color: "#152219",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: 24,
        }}
      >
        <main style={{ maxWidth: 440, textAlign: "center" }} role="alert">
          <h1 style={{ fontSize: 20, margin: "0 0 10px" }}>Algo saiu errado</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#4C5A50", margin: "0 0 18px" }}>
            Não conseguimos carregar o sistema. A falha foi registrada.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#4C5A50", margin: "0 0 18px" }}>
              Código: <code>{error.digest}</code>
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "9px 16px",
                borderRadius: 8,
                border: "none",
                background: "#1F3D2B",
                color: "#fff",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Recarregar
            </button>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "9px 16px",
                borderRadius: 8,
                border: "1px solid #D5D9D2",
                background: "transparent",
                color: "#152219",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Tentar de novo
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
