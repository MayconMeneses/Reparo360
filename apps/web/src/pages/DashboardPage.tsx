import { useState } from "react";
import { Remote } from "../components/parts";
import { stateLabel } from "../format";
import { useApi } from "../useApi";

interface Indicator {
  id: string;
  label: string;
  unit: string;
  scope: "atual" | "periodo";
  source: string;
  formula: string;
  includes: string;
  excludes: string;
  values: unknown;
}
interface Dashboard { period: { from: string; to: string }; indicators: Indicator[] }

const find = (d: Dashboard, id: string) => d.indicators.find((i) => i.id === id);

function humanizeSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1).replace(".", ",")} h`;
  return `${(seconds / 86400).toFixed(1).replace(".", ",")} d`;
}

function Explain({ indicator }: { indicator: Indicator }) {
  return (
    <details>
      <summary>Como é calculado</summary>
      <p><strong>Fonte:</strong> {indicator.source}</p>
      <p><strong>Fórmula:</strong> {indicator.formula}</p>
      <p><strong>Entra:</strong> {indicator.includes}</p>
      <p><strong>Não entra:</strong> {indicator.excludes}</p>
      <p><strong>Unidade:</strong> {indicator.unit}</p>
    </details>
  );
}

function Counter({ indicator, value }: { indicator: Indicator; value: number }) {
  return (
    <section className="card" aria-labelledby={`h-${indicator.id}`}>
      <h2 id={`h-${indicator.id}`}>{indicator.label}</h2>
      <p className="metric">{value}</p>
      <p className="muted">{indicator.scope === "atual" ? "Situação atual" : "No período"}</p>
      <Explain indicator={indicator} />
    </section>
  );
}

export function DashboardPage() {
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const query = range ? `?from=${range.from}&to=${range.to}` : "";
  const state = useApi<Dashboard>(`/dashboard${query}`);

  return (
    <>
      <h1>Dashboard</h1>
      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const from = String(data.get("from") ?? "");
          const to = String(data.get("to") ?? "");
          if (from && to) setRange({ from, to });
        }}
      >
        <div><label htmlFor="from">De</label><input id="from" name="from" type="date" required /></div>
        <div><label htmlFor="to">Até</label><input id="to" name="to" type="date" required /></div>
        <button type="submit">Aplicar período</button>
      </form>
      <Remote state={state} onRetry={state.reload}>
        {(d) => {
          const open = find(d, "os_abertas");
          const received = find(d, "recebidas_periodo");
          const delivered = find(d, "entregues_periodo");
          const decided = find(d, "orcamentos_decididos");
          const byState = find(d, "por_estado");
          const stages = find(d, "tempo_por_etapa");
          const byCategory = find(d, "servicos_por_categoria");
          const decisions = (decided?.values ?? { aprovado: 0, recusado: 0 }) as { aprovado: number; recusado: number };
          return (
            <>
              <p className="muted">Período: {d.period.from} a {d.period.to} (horário de Brasília)</p>
              <div className="grid">
                {open ? <Counter indicator={open} value={open.values as number} /> : null}
                {received ? <Counter indicator={received} value={received.values as number} /> : null}
                {delivered ? <Counter indicator={delivered} value={delivered.values as number} /> : null}
                {decided ? (
                  <section className="card" aria-labelledby="h-dec">
                    <h2 id="h-dec">{decided.label}</h2>
                    <p>Aprovados: <span className="metric">{decisions.aprovado}</span></p>
                    <p>Recusados: <span className="metric">{decisions.recusado}</span></p>
                    <Explain indicator={decided} />
                  </section>
                ) : null}
              </div>
              {byState ? (
                <section className="card" aria-labelledby="h-state" style={{ marginTop: 16 }}>
                  <h2 id="h-state">{byState.label}</h2>
                  <ul>
                    {Object.entries(byState.values as Record<string, number>).map(([code, total]) => (
                      <li key={code}>{stateLabel(code)}: <strong>{total}</strong></li>
                    ))}
                  </ul>
                  <Explain indicator={byState} />
                </section>
              ) : null}
              {stages ? (
                <section className="card" aria-labelledby="h-stage" style={{ marginTop: 16 }}>
                  <h2 id="h-stage">{stages.label}</h2>
                  {(stages.values as Array<{ state: string; samples: number; medianSeconds: number | null }>).length === 0 ? (
                    <p className="muted">Sem etapas concluídas no período.</p>
                  ) : (
                    <ul>
                      {(stages.values as Array<{ state: string; samples: number; medianSeconds: number | null }>).map((s) => (
                        <li key={s.state}>{stateLabel(s.state)}: mediana {humanizeSeconds(s.medianSeconds)} ({s.samples} passagens)</li>
                      ))}
                    </ul>
                  )}
                  <Explain indicator={stages} />
                </section>
              ) : null}
              {byCategory ? (
                <section className="card" aria-labelledby="h-cat" style={{ marginTop: 16 }}>
                  <h2 id="h-cat">{byCategory.label}</h2>
                  {Object.keys(byCategory.values as object).length === 0 ? <p className="muted">Nenhuma OS no período.</p> : (
                    <ul>{Object.entries(byCategory.values as Record<string, number>).map(([cat, n]) => <li key={cat}>{cat}: <strong>{n}</strong></li>)}</ul>
                  )}
                  <Explain indicator={byCategory} />
                </section>
              ) : null}
            </>
          );
        }}
      </Remote>
    </>
  );
}
