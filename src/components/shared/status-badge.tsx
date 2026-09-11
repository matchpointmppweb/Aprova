// Badge de status reutilizável — porta `.tag`/`.tag-dot` do mockup
// (Mockup.html, tags tag-ok/tag-warn/tag-off/tag-neutral). Primeira
// aplicação (Story 1.2, tela Usuários); outras telas com enums de status
// diferentes (Ativos, Planos — AD-4, Consistency Conventions) reusam este
// mesmo componente em vez de reimplementar o badge por tela.
export type TomBadge = "ok" | "warn" | "off" | "neutral";

export function StatusBadge({ tom, label }: { tom: TomBadge; label: string }) {
  return (
    <span className={`tag tag-${tom}`}>
      <span className="tag-dot" />
      {label}
    </span>
  );
}
