import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabDef { id: string; label: string; badge?: string }

/** Abas acessíveis (padrão WAI-ARIA): setas, Home e End movem o foco e a seleção. */
export function Tabs({ tabs, active, onChange, children }: { tabs: TabDef[]; active: string; onChange: (id: string) => void; children: ReactNode }) {
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next];
    if (target) { onChange(target.id); refs.current[next]?.focus(); }
  }

  return (
    <div>
      <div role="tablist" aria-label="Seções da ordem de serviço" style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "16px 0" }}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`${base}-panel`}
            tabIndex={active === tab.id ? 0 : -1}
            className={active === tab.id ? "primary" : undefined}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {tab.label}{tab.badge ? ` (${tab.badge})` : ""}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${active}`} tabIndex={0}>{children}</div>
    </div>
  );
}
