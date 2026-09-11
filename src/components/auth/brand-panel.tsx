// Painel esquerdo da tela de login/recuperação de senha — portado de
// Mockup.html (`.login-brand`, AD-4). Os números fictícios do mockup
// ("1.284 ativos monitorados" etc.) foram trocados por texto de marketing
// genérico: o banco real começa vazio, mostrar métricas inventadas na tela
// de login de produção seria enganoso.
export function BrandPanel() {
  return (
    <div className="login-brand">
      <svg className="grid-art" viewBox="0 0 500 800" preserveAspectRatio="none">
        <g stroke="rgba(255,255,255,0.10)" strokeWidth="1">
          <line x1="0" y1="100" x2="500" y2="100" />
          <line x1="0" y1="200" x2="500" y2="200" />
          <line x1="0" y1="300" x2="500" y2="300" />
          <line x1="0" y1="400" x2="500" y2="400" />
          <line x1="0" y1="500" x2="500" y2="500" />
          <line x1="0" y1="600" x2="500" y2="600" />
          <line x1="0" y1="700" x2="500" y2="700" />
          <line x1="100" y1="0" x2="100" y2="800" />
          <line x1="200" y1="0" x2="200" y2="800" />
          <line x1="300" y1="0" x2="300" y2="800" />
          <line x1="400" y1="0" x2="400" y2="800" />
        </g>
        <circle cx="380" cy="140" r="60" fill="none" stroke="rgba(143,203,166,0.35)" strokeWidth="1.5" />
        <circle cx="90" cy="640" r="90" fill="none" stroke="rgba(143,203,166,0.22)" strokeWidth="1.5" />
        <path
          d="M60 720 C 90 660, 70 600, 110 560 C 150 520, 140 470, 180 430"
          fill="none"
          stroke="rgba(143,203,166,0.4)"
          strokeWidth="2"
        />
      </svg>
      <div className="login-brand-top">
        <div className="brand-mark">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 2C8 6 5 9 5 13a7 7 0 0 0 14 0c0-4-3-7-7-11z" fill="currentColor" />
          </svg>
        </div>
        <div className="brand-name">Raiz</div>
      </div>
      <div className="login-brand-mid">
        <h1>Controle de ativos, planos revisionais e emissões em um só lugar.</h1>
        <p>
          Cadastre ativos, defina planos de revisão e acompanhe cada emissão do
          início ao encerramento, com rastreabilidade completa.
        </p>
      </div>
      <div className="login-brand-bottom">
        <div className="login-stat">
          <b>Centralizado</b>
          <span>controle de ativos e revisões</span>
        </div>
        <div className="login-stat">
          <b>Rastreável</b>
          <span>do início ao encerramento</span>
        </div>
        <div className="login-stat">
          <b>Isolado</b>
          <span>por conta, sem exceções</span>
        </div>
      </div>
    </div>
  );
}
