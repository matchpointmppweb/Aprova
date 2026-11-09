import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ErroDePagina } from "@/src/components/shell/erro-de-pagina";
import { EsqueletoDePagina } from "@/src/components/shell/esqueleto-de-pagina";

// Diferido da Story 4.3, fechado em 02-11-2026: nenhuma rota tinha
// `loading.tsx` nem `error.tsx`. Uma falha em qualquer leitura de uma página
// virava a tela crua do Next — sem casca, sem explicação, sem caminho de
// volta.
//
// O que estes testes prendem é o COMPORTAMENTO que não se vê olhando: que a
// mensagem interna não vai para a tela, e que o código de rastreio vai.

function erroFalso(mensagem: string, digest?: string) {
  const erro = new Error(mensagem) as Error & { digest?: string };
  if (digest) erro.digest = digest;
  return erro;
}

describe("a tela de erro", () => {
  test("NÃO mostra a mensagem interna do erro", () => {
    // O ponto principal. Em produção o Next troca a mensagem de servidor por
    // um digest, mas em desenvolvimento ela passa — e uma tela que às vezes
    // vaza detalhe de banco é uma tela que vaza (Boundaries).
    render(
      <ErroDePagina error={erroFalso('relation "emissoes" does not exist')} reset={() => {}} />,
    );

    expect(document.body.textContent).not.toContain("emissoes");
    expect(document.body.textContent).not.toContain("does not exist");
  });

  test("mostra o código de rastreio, que liga a tela ao log do servidor", () => {
    render(<ErroDePagina error={erroFalso("x", "abc123")} reset={() => {}} />);
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  test("sem código, não mostra um rótulo vazio", () => {
    // Um "Código:" sem código é pior do que nenhum: a pessoa tenta relatá-lo.
    render(<ErroDePagina error={erroFalso("x")} reset={() => {}} />);
    expect(document.body.textContent).not.toContain("Código");
  });

  test("o botão de tentar de novo chama reset", async () => {
    const reset = vi.fn();
    render(<ErroDePagina error={erroFalso("x")} reset={reset} />);

    await userEvent.setup().click(screen.getByRole("button", { name: /Tentar de novo/ }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  test("o caminho de volta é uma âncora, não navegação de cliente", () => {
    // Se o erro veio do próprio roteamento, um <Link> falharia junto e o
    // botão não levaria a lugar nenhum.
    render(<ErroDePagina error={erroFalso("x")} reset={() => {}} />);
    const volta = screen.getByRole("link", { name: /Voltar ao início/ });
    expect(volta.getAttribute("href")).toBe("/");
  });

  test("é anunciada como alerta", () => {
    render(<ErroDePagina error={erroFalso("x")} reset={() => {}} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  test("aceita um título próprio por área", () => {
    render(<ErroDePagina error={erroFalso("x")} reset={() => {}} titulo="Título da área" />);
    expect(screen.getByRole("heading", { name: "Título da área" })).toBeInTheDocument();
  });
});

describe("o esqueleto de carregamento", () => {
  test("anuncia o carregamento por texto, não pelas faixas", () => {
    // As faixas são decoração; quem usa leitor de tela precisa da
    // informação, e um esqueleto sem texto não diz nada a ela.
    render(<EsqueletoDePagina />);
    expect(screen.getByRole("status").textContent).toContain("Carregando");
  });

  test("o desenho fica fora da árvore de acessibilidade", () => {
    render(<EsqueletoDePagina />);
    expect(document.querySelector(".esqueleto")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("o número de linhas é configurável", () => {
    render(<EsqueletoDePagina linhas={3} />);
    expect(document.querySelectorAll(".esq-linha")).toHaveLength(3);
  });
});
