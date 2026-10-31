import { formatDateTime, stateLabel } from "../format";
import { EVENT_LABEL } from "./actions";
import type { TabProps } from "./types";

export function HistoryTab({ order }: TabProps) {
  return (
    <section className="card" aria-labelledby="h-hist">
      <h2 id="h-hist">Histórico da ordem</h2>
      <p className="muted">Registro permanente: nada aqui é apagado ou alterado.</p>
      <ol>
        {order.events.map((e, index) => (
          <li key={index}>
            <strong>{formatDateTime(e.createdAt)}</strong> · {EVENT_LABEL[e.type] ?? e.type.replaceAll("_", " ")}
            {e.fromState && e.toState ? ` (${stateLabel(e.fromState)} → ${stateLabel(e.toState)})` : ""}
            {e.reason ? ` — registro: ${e.reason}` : ""}
          </li>
        ))}
      </ol>
    </section>
  );
}
