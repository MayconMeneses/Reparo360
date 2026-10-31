import { Link, useParams } from "react-router-dom";
import { Empty, Remote } from "../components/parts";
import { formatBrl, formatDateTime, QUOTE_STATE_LABEL, stateLabel } from "../format";
import { useAuth } from "../auth";
import { useApi } from "../useApi";
import { PortalLinkPanel } from "./PortalLinkPanel";

interface Detail {
  protocol: string;
  state: string;
  priority: string;
  reportedDefect: string;
  version: number;
  createdAt: string;
  customer: { name: string; phone?: string; email?: string | null } | null;
  device: { category: string; brand: string; model: string; color: string | null } | null;
  inspection: { physicalCondition: string; accessories: string[]; checklist: Array<{ item: string; result: string }>; passwordInformed: boolean } | null;
  events: Array<{ type: string; fromState: string | null; toState: string | null; reason: string | null; createdAt: string }>;
  diagnostics: Array<{ revision: number; nature: string; findings: string | null }>;
  quotes: Array<{ id: string; number: number; state: string; totalCents: number }>;
  repairs: Array<{ id: string; procedure: string; outcome: string; createdAt: string }>;
}

export function OrderDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const state = useApi<Detail>(id ? `/work-orders/${encodeURIComponent(id)}` : null);
  return (
    <>
      <p><Link to="/ordens">← Voltar para as ordens</Link></p>
      <Remote state={state} onRetry={state.reload}>
        {(o) => (
          <>
            <h1>Ordem {o.protocol}</h1>
            <p><span className="badge">{stateLabel(o.state)}</span> <span className="muted">prioridade {o.priority} · aberta em {formatDateTime(o.createdAt)}</span></p>
            <div className="grid">
              <section className="card" aria-labelledby="h-cli">
                <h2 id="h-cli">Cliente</h2>
                <p>{o.customer?.name}</p>
                {o.customer?.phone ? <p>{o.customer.phone}</p> : null}
              </section>
              <section className="card" aria-labelledby="h-dev">
                <h2 id="h-dev">Equipamento</h2>
                <p>{o.device ? `${o.device.brand} ${o.device.model}` : "—"}</p>
                <p className="muted">{o.device?.category}</p>
              </section>
            </div>
            <section className="card" aria-labelledby="h-def" style={{ marginTop: 16 }}>
              <h2 id="h-def">Recebimento</h2>
              <p><strong>Defeito relatado:</strong> {o.reportedDefect}</p>
              {o.inspection ? (
                <>
                  <p><strong>Estado físico:</strong> {o.inspection.physicalCondition}</p>
                  <p><strong>Acessórios:</strong> {o.inspection.accessories.join(", ") || "nenhum"}</p>
                  <p><strong>Senha do aparelho informada:</strong> {o.inspection.passwordInformed ? "sim" : "não"}</p>
                </>
              ) : null}
            </section>
            <section className="card" aria-labelledby="h-diag" style={{ marginTop: 16 }}>
              <h2 id="h-diag">Diagnóstico e orçamento</h2>
              {o.diagnostics.length === 0 ? <Empty>Sem diagnóstico registrado.</Empty> : <p>Revisão {o.diagnostics[0]?.revision}: {o.diagnostics[0]?.findings ?? "sem defeito identificado"}</p>}
              {o.quotes.map((q) => <p key={q.id}>Versão {q.number}: {QUOTE_STATE_LABEL[q.state] ?? "Rascunho"} · {formatBrl(q.totalCents)}</p>)}
              <p className="muted">{o.repairs.length} tarefa(s) de reparo registrada(s).</p>
            </section>
            {id ? <PortalLinkPanel orderId={id} closed={o.state === "ENCERRADA" || o.state === "CANCELADA"} /> : null}
            {id && can("document.generate") ? (
              <section className="card" aria-labelledby="h-docs" style={{ marginTop: 16 }}>
                <h2 id="h-docs">Documentos e etiqueta</h2>
                <ul>
                  <li><a href={`/api/v1/work-orders/${id}/documents/receipt`}>Comprovante de recebimento (PDF)</a></li>
                  <li><a href={`/api/v1/work-orders/${id}/documents/sheet`}>Ordem de serviço (PDF)</a></li>
                  <li><Link to={`/etiqueta/${id}`}>Etiqueta com QR Code</Link></li>
                </ul>
              </section>
            ) : null}
            <section className="card" aria-labelledby="h-hist" style={{ marginTop: 16 }}>
              <h2 id="h-hist">Histórico</h2>
              <ol>
                {o.events.map((e, index) => (
                  <li key={index}>{formatDateTime(e.createdAt)} — {e.type.replaceAll("_", " ")}{e.reason ? ` (${e.reason})` : ""}</li>
                ))}
              </ol>
            </section>
          </>
        )}
      </Remote>
    </>
  );
}
