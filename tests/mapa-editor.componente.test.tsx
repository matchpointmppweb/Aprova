import { useState } from "react";
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MapaEditor, type PontoMapa } from "@/src/components/locais/mapa-editor";

// Diferido da Story 5.1, fechado em 02-11-2026: o editor de área era
// só-mouse. Um `onClick` no `<svg>`, sem equivalente de teclado, sem nome
// acessível, e desfazer/limpar mudavam o desenho sem anunciar nada.
//
// Teste de COMPONENTE porque é o único lugar onde isso existe: operação por
// teclado não tem contraparte no servidor, e nenhum teste de lógica pura
// diria se a tecla chega ao controle.

function Bancada() {
  const [pontos, setPontos] = useState<PontoMapa[]>([]);
  return (
    <>
      <MapaEditor pontos={pontos} onChange={setPontos} />
      <div data-testid="quantos">{pontos.length}</div>
      <div data-testid="pontos">{JSON.stringify(pontos)}</div>
    </>
  );
}

function superficie() {
  return screen.getByRole("application");
}

function quantos() {
  return Number(screen.getByTestId("quantos").textContent);
}

describe("o editor de área funciona pelo teclado", () => {
  test("a superfície recebe foco e tem nome acessível", async () => {
    render(<Bancada />);
    const usuario = userEvent.setup();
    await usuario.tab();

    // Sem `tabIndex` a superfície nunca entra na ordem de tabulação, e o
    // controle fica inalcançável sem mouse.
    expect(superficie()).toHaveFocus();
    expect(superficie().getAttribute("aria-label")).toContain("setas");
  });

  test("Enter marca um vértice", async () => {
    render(<Bancada />);
    const usuario = userEvent.setup();
    await usuario.tab();
    await usuario.keyboard("{Enter}");

    expect(quantos()).toBe(1);
  });

  test("as setas movem o cursor ANTES de marcar, e o ponto sai do centro", async () => {
    // O vizinho que distingue "aceita teclas" de "as teclas fazem efeito":
    // sem mover de verdade, todos os vértices nasceriam no mesmo lugar.
    render(<Bancada />);
    const usuario = userEvent.setup();
    await usuario.tab();
    await usuario.keyboard("{Enter}");
    await usuario.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}");
    await usuario.keyboard("{Enter}");

    const pontos = JSON.parse(screen.getByTestId("pontos").textContent ?? "[]") as PontoMapa[];
    expect(pontos).toHaveLength(2);
    expect(pontos[1].x).toBeGreaterThan(pontos[0].x);
    expect(pontos[1].y).toBeGreaterThan(pontos[0].y);
  });

  test("Shift move mais rápido que a seta simples", async () => {
    render(<Bancada />);
    const usuario = userEvent.setup();
    await usuario.tab();
    await usuario.keyboard("{ArrowRight}{Enter}");
    await usuario.keyboard("{Shift>}{ArrowRight}{/Shift}{Enter}");

    const pontos = JSON.parse(screen.getByTestId("pontos").textContent ?? "[]") as PontoMapa[];
    expect(pontos[1].x - pontos[0].x).toBeGreaterThan(10);
  });

  test("o cursor não escapa da área", async () => {
    // Sem o limite, marcar um vértice fora do viewBox gravaria coordenada
    // que o polígono não consegue desenhar.
    render(<Bancada />);
    const usuario = userEvent.setup();
    await usuario.tab();
    await usuario.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}".concat(
      "{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}",
    ));
    await usuario.keyboard("{Enter}");

    const pontos = JSON.parse(screen.getByTestId("pontos").textContent ?? "[]") as PontoMapa[];
    expect(pontos[0].x).toBe(0);
  });

  test("Backspace desfaz o último vértice", async () => {
    render(<Bancada />);
    const usuario = userEvent.setup();
    await usuario.tab();
    await usuario.keyboard("{Enter}{ArrowRight}{Enter}");
    expect(quantos()).toBe(2);

    await usuario.keyboard("{Backspace}");
    expect(quantos()).toBe(1);
  });

  test("Backspace sem vértice nenhum não quebra nada", async () => {
    render(<Bancada />);
    const usuario = userEvent.setup();
    await usuario.tab();
    await usuario.keyboard("{Backspace}");

    expect(quantos()).toBe(0);
  });

  test("uma tecla que o controle não usa é ignorada", async () => {
    // `preventDefault` só nas teclas próprias: engolir tudo impediria a
    // pessoa de sair do controle com Tab.
    render(<Bancada />);
    const usuario = userEvent.setup();
    await usuario.tab();
    await usuario.keyboard("a");

    expect(quantos()).toBe(0);
  });
});

describe("o estado do desenho é anunciado", () => {
  test("começa dizendo que não há vértice", () => {
    render(<Bancada />);
    expect(screen.getByRole("status").textContent).toContain("Nenhum vértice");
  });

  test("a contagem é anunciada, no singular e no plural", async () => {
    // A outra metade do diferido: desfazer e limpar mudavam o desenho sem
    // anunciar nada, então quem não vê a tela não sabia se funcionou.
    render(<Bancada />);
    const usuario = userEvent.setup();
    await usuario.tab();

    await usuario.keyboard("{Enter}");
    expect(screen.getByRole("status").textContent).toContain("1 vértice ");

    await usuario.keyboard("{ArrowRight}{Enter}");
    expect(screen.getByRole("status").textContent).toContain("2 vértices");
  });

  test("limpar volta a anunciar que não há vértice", async () => {
    render(<Bancada />);
    const usuario = userEvent.setup();
    await usuario.tab();
    await usuario.keyboard("{Enter}");

    await usuario.click(screen.getByRole("button", { name: /Limpar/ }));

    expect(screen.getByRole("status").textContent).toContain("Nenhum vértice");
  });

  test("o fundo decorativo fica fora da árvore de acessibilidade", async () => {
    // E a superfície de desenho NÃO: esconder a parte interativa foi um erro
    // real de uma passada anterior, e é o que este teste impede de voltar.
    render(<Bancada />);
    expect(superficie().getAttribute("aria-hidden")).toBeNull();
    const fundo = document.querySelector(".map-bg");
    expect(fundo?.getAttribute("aria-hidden")).toBe("true");
  });
});
