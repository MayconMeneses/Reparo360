import { useState } from "react";
import { DataTable, Remote } from "../components/parts";
import { formatDateTime } from "../format";
import { useApi } from "../useApi";
import { ACTION_FILTER_OPTIONS, ACTOR_LABEL, actionLabel } from "./auditLabels";

interface AuditEvent {
  id: string;
  at: string;
  action: string;
  outcome: string;
  targetType: string | null;
  reason: string | null;
  actor: { kind: string; name: string | null };
}

const PAGE = 20;
const TARGET_LABEL: Record<string, string> = { work_order: "Ordem", quote: "Orçamento", tenant: "Assistência", attachment: "Anexo", user: "Usuário" };

/** Registro de quem fez o quê (RF-023). Só leitura; proprietário e gerente. Nunca mostra IP nem identificadores internos. */
export function AuditPage() {
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);

  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (action) params.set("action", action);
  if (outcome) params.set("outcome", outcome);
  // Só envia o período quando completo e coerente; o servidor valida de novo.
  const periodOk = from !== "" && to !== "" && from <= to;
  if (periodOk) { params.set("from", from); params.set("to", to); }
  const state = useApi<{ events: AuditEvent[]; hasMore: boolean }>(`/audit?${params.toString()}`);
  const reset = () => setOffset(0);

  return (
    <>
      <h1>Auditoria</h1>
      <p className="muted">Registro de quem fez o quê no sistema. Somente leitura. Não mostra senhas, códigos nem endereços de rede.</p>
      <form className="filters" aria-label="Filtros da auditoria" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="f-action">Ação</label>
        <select id="f-action" value={action} onChange={(e) => { setAction(e.target.value); reset(); }}>
          <option value="">Todas</option>
          {ACTION_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label htmlFor="f-outcome">Resultado</label>
        <select id="f-outcome" value={outcome} onChange={(e) => { setOutcome(e.target.value); reset(); }}>
          <option value="">Todos</option>
          <option value="ok">Concluído</option>
          <option value="negado">Negado</option>
        </select>
        <label htmlFor="f-from">De</label>
        <input id="f-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />
        <label htmlFor="f-to">Até</label>
        <input id="f-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
      </form>
      {(from !== "" || to !== "") && !periodOk ? <p role="status" className="muted">Informe as duas datas, com “De” antes de “Até”, para filtrar por período.</p> : null}
      <Remote state={state} onRetry={state.reload}>
        {({ events, hasMore }) => (
          <>
            <DataTable
              caption="Eventos registrados, do mais recente para o mais antigo"
              rows={events}
              rowKey={(r) => r.id}
              empty="Nenhum evento para estes filtros."
              columns={[
                { header: "Quando", render: (r) => formatDateTime(r.at) },
                { header: "Quem", render: (r) => r.actor.name ?? ACTOR_LABEL[r.actor.kind] ?? "—" },
                { header: "O quê", render: (r) => actionLabel(r.action) },
                { header: "Resultado", render: (r) => <span className="badge">{r.outcome === "ok" ? "Concluído" : "Negado"}</span> },
                { header: "Sobre", render: (r) => (r.targetType ? TARGET_LABEL[r.targetType] ?? r.targetType : "—") },
                { header: "Motivo", render: (r) => r.reason ?? "—" },
              ]}
            />
            <p className="actions">
              <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Anteriores</button>
              <button type="button" disabled={!hasMore} onClick={() => setOffset(offset + PAGE)}>Próximos</button>
            </p>
          </>
        )}
      </Remote>
    </>
  );
}
