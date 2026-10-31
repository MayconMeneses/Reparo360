import { useEffect, useState } from "react";
import { formatBrl, formatDateTime, QUOTE_STATE_LABEL, tokenFromHash } from "../format";
import { PortalDecision } from "./PortalDecision";

interface PortalView {
  protocol: string;
  state: { code: string; label: string };
  device: { category: string; brand: string; model: string } | null;
  assistance: { name: string; phone: string | null };
  timeline: Array<{ label: string; at: string }>;
  quote: {
    number: number; state: string; subtotalCents: number; discountCents: number; totalCents: number; validUntil: string | null;
    paymentTerms: string | null; estimatedDays: number | null; items: Array<{ kind: string; description: string; quantity: number; unitPriceCents: number }>;
  } | null;
  decisionMessage: string;
  canDecide: boolean;
  emailHint?: string;
  readyForPickup: boolean;
}

type View = { kind: "loading" } | { kind: "invalid" } | { kind: "error" } | { kind: "ready"; data: PortalView };

/**
 * Portal do consumidor: público, somente leitura. O token vem do FRAGMENTO da URL (#t=...), que o navegador
 * nunca envia ao servidor, e segue num cabeçalho — assim não entra em log de acesso nem em Referer.
 */
export function PortalPage() {
  const [view, setView] = useState<View>({ kind: "loading" });

  const [reload, setReload] = useState(0);
  const token = tokenFromHash(window.location.hash);

  useEffect(() => {
    if (!token) { setView({ kind: "invalid" }); return; }
    const controller = new AbortController();
    fetch("/api/v1/portal/order", { headers: { "x-portal-token": token }, credentials: "omit", signal: controller.signal }).then(
      async (response) => {
        if (response.ok) setView({ kind: "ready", data: (await response.json()) as PortalView });
        else setView({ kind: response.status === 404 ? "invalid" : "error" });
      },
      () => { if (!controller.signal.aborted) setView({ kind: "error" }); },
    );
    return () => controller.abort();
  }, [token, reload]);

  return (
    <main className="portal" style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      {view.kind === "loading" ? <p role="status" className="state">Carregando…</p> : null}
      {view.kind === "invalid" ? (
        <div role="alert" className="state">
          <h1>Link inválido ou expirado</h1>
          <p>Confira se o link está completo ou peça um novo à assistência.</p>
        </div>
      ) : null}
      {view.kind === "error" ? <p role="alert" className="state error">Não foi possível carregar agora. Tente novamente em instantes.</p> : null}
      {view.kind === "ready" && token ? <Ready data={view.data} token={token} onDecided={() => setReload((n) => n + 1)} /> : null}
    </main>
  );
}

function Ready({ data, token, onDecided }: { data: PortalView; token: string; onDecided: () => void }) {
  const q = data.quote;
  const phone = data.assistance.phone;
  return (
    <>
      <p className="muted">{data.assistance.name}</p>
      <h1>Acompanhe seu atendimento</h1>
      <section className="card" aria-labelledby="p-status">
        <h2 id="p-status">Situação</h2>
        <p><span className="badge">{data.state.label}</span></p>
        <p>Protocolo <strong>{data.protocol}</strong>{data.device ? ` · ${data.device.brand} ${data.device.model}` : ""}</p>
        {data.readyForPickup ? <p><strong>Seu equipamento está pronto para retirada.</strong></p> : null}
      </section>

      {q ? (
        <section className="card" aria-labelledby="p-quote" style={{ marginTop: 16 }}>
          <h2 id="p-quote">Orçamento (versão {q.number})</h2>
          {q.state === "substituido" ? <p className="error">Esta versão foi substituída. Fale com a assistência.</p> : null}
          {q.state === "expirado" ? <p className="error">Este orçamento expirou. Fale com a assistência.</p> : null}
          <p><span className="badge">{QUOTE_STATE_LABEL[q.state] ?? q.state}</span></p>
          <div className="table-wrap">
            <table>
              <caption>Itens do orçamento</caption>
              <thead><tr><th scope="col">Item</th><th scope="col">Qtd.</th><th scope="col">Valor unitário</th></tr></thead>
              <tbody>
                {q.items.map((item, index) => (
                  <tr key={index}><td>{item.kind === "peca" ? "Peça" : "Serviço"}: {item.description}</td><td>{item.quantity}</td><td>{formatBrl(item.unitPriceCents)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>Subtotal: {formatBrl(q.subtotalCents)} · Desconto: {formatBrl(q.discountCents)}</p>
          <p><strong>Total: {formatBrl(q.totalCents)}</strong></p>
          {q.paymentTerms ? <p>Condições de pagamento: {q.paymentTerms}</p> : null}
          {q.estimatedDays ? <p>Previsão de execução: {q.estimatedDays} dia(s)</p> : null}
          {q.validUntil ? <p>Válido até {formatDateTime(q.validUntil)}</p> : null}
        </section>
      ) : null}

      {data.canDecide ? <PortalDecision token={token} emailHint={data.emailHint} onDecided={onDecided} /> : null}

      <section className="card" aria-labelledby="p-line" style={{ marginTop: 16 }}>
        <h2 id="p-line">Andamento</h2>
        <ol>{data.timeline.map((e, index) => <li key={index}>{formatDateTime(e.at)}: {e.label}</li>)}</ol>
      </section>

      <section className="card" aria-labelledby="p-contact" style={{ marginTop: 16 }}>
        <h2 id="p-contact">Fale com a assistência</h2>
        <p>{data.decisionMessage}</p>
        {phone ? <p><a href={`tel:${phone}`}>Ligar para {phone}</a></p> : <p className="muted">Telefone não informado pela assistência.</p>}
      </section>
    </>
  );
}
