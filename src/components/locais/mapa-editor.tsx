"use client";

import { useState } from "react";

// Editor de polígono de área (UX-DR3/AD-14), portado de Mockup.html:997-1017
// (.map-field/.map-picker/.map-polygon/.map-vertex/.map-hint/.map-actions,
// já em src/styles/globals.css). Puramente client-side e decorativo: o fundo
// (.map-bg) é um SVG estático fixo, nunca um mapa geográfico real — nenhuma
// chamada de rede aqui (Never da story). Componente controlado: quem chama
// guarda `pontos` no próprio estado e sincroniza um <input type="hidden"> com
// JSON.stringify(pontos) para submeter junto do resto do form (Code Map).
//
// Acessibilidade (diferido da Story 5.1, fechado em 02-11-2026). O controle
// era só-mouse: um `onClick` no `<svg>`, sem equivalente de teclado, sem
// nome acessível e sem nada anunciando o resultado de desfazer/limpar.
//
// A superfície de desenho é `role="application"` de propósito: ela consome as
// setas do teclado, e sem esse papel o leitor de tela as interceptaria para
// navegar pelo documento — o cursor nunca sairia do lugar. Em troca, o nome e
// a instrução precisam vir no próprio controle, porque dentro de
// `application` o leitor para de descrever a estrutura ao redor.
//
// O fundo (.map-bg) continua `aria-hidden`: ele é decoração, e descrevê-lo
// não ajudaria ninguém. A superfície de desenho NÃO é — esconder a parte
// interativa foi um erro que esta versão corrige.

export interface PontoMapa {
  x: number;
  y: number;
}

const VIEWBOX = "0 0 600 300";
const LARGURA = 600;
const ALTURA = 300;

/// Passo do cursor por tecla. 10 unidades do viewBox: grande o bastante para
/// atravessar a área em poucas teclas, pequeno o bastante para marcar um
/// vértice onde a pessoa quis. Shift multiplica, para a travessia longa.
const PASSO = 10;
const PASSO_LONGO = 50;

function limitar(valor: number, maximo: number): number {
  return Math.min(maximo, Math.max(0, valor));
}

export function MapaEditor({
  pontos,
  onChange,
}: {
  pontos: PontoMapa[];
  onChange: (pontos: PontoMapa[]) => void;
}) {
  // Cursor do teclado. Nasce no centro, e não em 0,0: o canto é o lugar menos
  // útil para começar e obrigaria a atravessar a área inteira sempre.
  const [cursor, setCursor] = useState<PontoMapa>({
    x: LARGURA / 2,
    y: ALTURA / 2,
  });
  const [usandoTeclado, setUsandoTeclado] = useState(false);

  // Converte a posição do clique em coordenadas do viewBox do editor —
  // mesma técnica do mockup: createSVGPoint().matrixTransform(svg.
  // getScreenCTM().inverse()). Nunca lat/long (AD-14).
  function aoClicar(evento: React.MouseEvent<SVGSVGElement>) {
    const svg = evento.currentTarget;
    const ponto = svg.createSVGPoint();
    ponto.x = evento.clientX;
    ponto.y = evento.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const local = ponto.matrixTransform(ctm.inverse());
    const novo = { x: Math.round(local.x), y: Math.round(local.y) };
    setCursor(novo);
    onChange([...pontos, novo]);
  }

  function aoTeclar(evento: React.KeyboardEvent<SVGSVGElement>) {
    const passo = evento.shiftKey ? PASSO_LONGO : PASSO;
    const mover = (dx: number, dy: number) => {
      // `preventDefault` só nas teclas que o controle de fato usa: deixar o
      // Tab e o Enter de formulário passarem é o que mantém a pessoa capaz
      // de sair daqui.
      evento.preventDefault();
      setUsandoTeclado(true);
      setCursor((atual) => ({
        x: limitar(atual.x + dx, LARGURA),
        y: limitar(atual.y + dy, ALTURA),
      }));
    };

    switch (evento.key) {
      case "ArrowLeft":
        return mover(-passo, 0);
      case "ArrowRight":
        return mover(passo, 0);
      case "ArrowUp":
        return mover(0, -passo);
      case "ArrowDown":
        return mover(0, passo);
      case "Enter":
      case " ":
        evento.preventDefault();
        setUsandoTeclado(true);
        onChange([...pontos, cursor]);
        return;
      case "Backspace":
      case "Delete":
        evento.preventDefault();
        setUsandoTeclado(true);
        desfazerUltimoPonto();
        return;
      default:
        return;
    }
  }

  function desfazerUltimoPonto() {
    if (pontos.length === 0) return;
    onChange(pontos.slice(0, -1));
  }

  function limparPoligono() {
    onChange([]);
  }

  // O que o leitor de tela anuncia. Em vez de coordenadas — que não
  // significam nada num mapa decorativo —, a contagem de vértices e a posição
  // do cursor em porcentagem da área, que é o único jeito de a pessoa saber
  // onde está sem ver.
  const posicao = `${Math.round((cursor.x / LARGURA) * 100)}% da esquerda, ${Math.round(
    (cursor.y / ALTURA) * 100,
  )}% do topo`;
  const estado =
    pontos.length === 0
      ? "Nenhum vértice marcado."
      : `${pontos.length} ${pontos.length === 1 ? "vértice" : "vértices"} marcados.`;

  return (
    <div className="map-field">
      <label htmlFor="mapa-area">Área do local (polígono)</label>
      <div className="map-picker">
        <svg className="map-bg" viewBox={VIEWBOX} preserveAspectRatio="none" aria-hidden="true">
          <rect width="600" height="300" fill="#CFE3D3" />
          <rect x="0" y="118" width="600" height="24" fill="#EDEADF" />
          <rect x="176" y="0" width="24" height="300" fill="#EDEADF" />
          <rect x="430" y="0" width="18" height="300" fill="#EDEADF" />
          <rect x="36" y="26" width="120" height="76" fill="#BFD8C4" />
          <rect x="224" y="26" width="180" height="76" fill="#BFD8C4" />
          <rect x="470" y="26" width="98" height="76" fill="#BFD8C4" />
          <rect x="36" y="166" width="120" height="106" fill="#BFD8C4" />
          <rect x="224" y="166" width="180" height="106" fill="#BFD8C4" />
          <rect x="470" y="166" width="98" height="106" fill="#BFD8C4" />
        </svg>
        <svg
          id="mapa-area"
          className="map-draw"
          viewBox={VIEWBOX}
          preserveAspectRatio="none"
          role="application"
          tabIndex={0}
          aria-label="Área do local. Use as setas para mover o cursor, Enter para marcar um vértice e Backspace para desfazer o último. Shift com as setas move mais rápido."
          aria-describedby="mapa-area-estado"
          onClick={aoClicar}
          onKeyDown={aoTeclar}
        >
          <g className="map-points">
            {pontos.length > 1 ? (
              <polygon
                className="map-polygon"
                points={pontos.map((p) => `${p.x},${p.y}`).join(" ")}
              />
            ) : null}
            {pontos.map((p, indice) => (
              <circle key={indice} className="map-vertex" cx={p.x} cy={p.y} r={5} />
            ))}
          </g>
          {/* O cursor só aparece depois da primeira tecla: num uso de mouse
              ele seria um ponto a mais na tela, confundido com um vértice. */}
          {usandoTeclado ? (
            <g className="map-cursor" aria-hidden="true">
              <line x1={cursor.x - 12} y1={cursor.y} x2={cursor.x + 12} y2={cursor.y} />
              <line x1={cursor.x} y1={cursor.y - 12} x2={cursor.x} y2={cursor.y + 12} />
            </g>
          ) : null}
        </svg>
        <div className="map-hint">Clique, ou use as setas e Enter, para marcar os vértices</div>
      </div>
      {/* `aria-live` fecha a outra metade do diferido: desfazer e limpar
          mudavam o desenho sem anunciar nada, então quem não vê a tela não
          tinha como saber se o comando funcionou. */}
      <div id="mapa-area-estado" className="map-estado" role="status" aria-live="polite">
        {estado}
        {usandoTeclado ? ` Cursor em ${posicao}.` : ""}
      </div>
      <div className="map-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={desfazerUltimoPonto}
          disabled={pontos.length === 0}
        >
          Desfazer último ponto
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={limparPoligono}
          disabled={pontos.length === 0}
        >
          Limpar polígono
        </button>
      </div>
    </div>
  );
}
