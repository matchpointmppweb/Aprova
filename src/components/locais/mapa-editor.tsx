"use client";

// Editor de polígono de área (UX-DR3/AD-14), portado de Mockup.html:997-1017
// (.map-field/.map-picker/.map-polygon/.map-vertex/.map-hint/.map-actions,
// já em src/styles/globals.css). Puramente client-side e decorativo: o fundo
// (.map-bg) é um SVG estático fixo, nunca um mapa geográfico real — nenhuma
// chamada de rede aqui (Never da story). Componente controlado: quem chama
// guarda `pontos` no próprio estado e sincroniza um <input type="hidden"> com
// JSON.stringify(pontos) para submeter junto do resto do form (Code Map).
export interface PontoMapa {
  x: number;
  y: number;
}

const VIEWBOX = "0 0 600 300";

export function MapaEditor({
  pontos,
  onChange,
}: {
  pontos: PontoMapa[];
  onChange: (pontos: PontoMapa[]) => void;
}) {
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
    onChange([...pontos, { x: Math.round(local.x), y: Math.round(local.y) }]);
  }

  function desfazerUltimoPonto() {
    if (pontos.length === 0) return;
    onChange(pontos.slice(0, -1));
  }

  function limparPoligono() {
    onChange([]);
  }

  return (
    <div className="map-field">
      <label>Área do local (polígono)</label>
      <div className="map-picker">
        <svg className="map-bg" viewBox={VIEWBOX} preserveAspectRatio="none">
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
          className="map-draw"
          viewBox={VIEWBOX}
          preserveAspectRatio="none"
          onClick={aoClicar}
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
        </svg>
        <div className="map-hint">Clique para marcar os vértices</div>
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
