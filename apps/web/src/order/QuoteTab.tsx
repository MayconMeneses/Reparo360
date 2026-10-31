import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { DataTable } from "../components/parts";
import { formatBrl, formatDateTime, QUOTE_STATE_LABEL } from "../format";
import { Message, TextArea, TextField, useAction } from "../ui/form";
import { QuoteEditor } from "./QuoteEditor";
import type { Quote, TabProps } from "./types";

function QuoteSummary({ quote }: { quote: Quote }) {
  return (
    <>
      <p><span className="badge">{QUOTE_STATE_LABEL[quote.state] ?? "Rascunho"}</span> {quote.validUntil ? <span className="muted">válido até {formatDateTime(quote.validUntil)}</span> : null}</p>
      <DataTable
        caption={`Itens da versão ${quote.number}`}
        rows={quote.items}
        rowKey={(i) => `${i.kind}-${i.description}`}
        empty="Sem itens."
        columns={[
          { header: "Item", render: (i) => `${i.kind === "peca" ? "Peça" : "Serviço"}: ${i.description}` },
          { header: "Qtd.", render: (i) => i.quantity },
          { header: "Unitário", render: (i) => formatBrl(i.unitPriceCents) },
          { header: "Total", render: (i) => formatBrl(i.quantity * i.unitPriceCents) },
        ]}
      />
      <p>Subtotal {formatBrl(quote.subtotalCents)} · Desconto {formatBrl(quote.discountCents)} · <strong>Total {formatBrl(quote.totalCents)}</strong></p>
      <p className="muted">{quote.paymentTerms ?? "Sem condições de pagamento"} · {quote.estimatedDays ? `${quote.estimatedDays} dia(s)` : "sem previsão"}</p>
    </>
  );
}

function DecisionForm({ quote, reload }: { quote: Quote; reload: () => void }) {
  const [decision, setDecision] = useState<"aprovado" | "recusado">("aprovado");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [partUnavailable, setPartUnavailable] = useState(false);
  const { run, busy, message } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(() => api(`/quotes/${quote.id}/decision`, {
      method: "POST", body: { decision, confirmedByName: name, note: note || undefined, partUnavailable: decision === "aprovado" && partUnavailable },
    }), decision === "aprovado" ? "Aprovação registrada." : "Recusa registrada.");
    // Orçamento vencido: o servidor já o marcou como expirado; recarregar mostra a situação real.
    if (result.ok || (result.error instanceof ApiError && ["ORCAMENTO_EXPIRADO", "DECISAO_CONFLITANTE", "ORCAMENTO_NAO_ENVIADO"].includes(result.error.code))) reload();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card" style={{ marginTop: 16, maxWidth: 560 }} aria-labelledby="h-decisao">
      <h2 id="h-decisao">Registrar decisão do cliente (presencial)</h2>
      <p className="muted">Fica registrada como decisão presencial, vinculada a esta versão. A aprovação à distância ainda não existe.</p>
      <fieldset style={{ border: 0, padding: 0 }}>
        <legend><strong>Decisão</strong></legend>
        {(["aprovado", "recusado"] as const).map((value) => (
          <label key={value} style={{ fontWeight: 400, display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
            <input type="radio" name="decision" style={{ width: "auto", minHeight: 0 }} checked={decision === value} onChange={() => setDecision(value)} />
            {value === "aprovado" ? "Cliente aprovou" : "Cliente recusou"}
          </label>
        ))}
      </fieldset>
      <TextField label="Nome de quem decidiu" value={name} onChange={setName} required />
      {decision === "aprovado" ? (
        <label style={{ fontWeight: 400, display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
          <input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={partUnavailable} onChange={(e) => setPartUnavailable(e.target.checked)} />
          A peça não está disponível agora (aguardar peça)
        </label>
      ) : null}
      <TextArea label="Anotação (opcional)" value={note} onChange={setNote} />
      <Message message={message} />
      <p><button type="submit" className="primary" disabled={busy || name.trim().length < 2}>Registrar decisão</button></p>
    </form>
  );
}

export function QuoteTab({ order, reload }: TabProps) {
  const { can } = useAuth();
  const { run, busy, message } = useAction();
  const open = order.quotes.find((q) => q.state === "rascunho" || q.state === "enviado") ?? null;
  const past = order.quotes.filter((q) => q !== open);
  const canEdit = order.state === "EM_DIAGNOSTICO" && can("quote.create");

  return (
    <>
      {!open && !canEdit ? <p className="state muted">Não há orçamento em aberto. O orçamento é montado enquanto a OS está em diagnóstico.</p> : null}
      {!open && canEdit ? <QuoteEditor key="novo" order={order} draft={null} reload={reload} /> : null}
      {open?.state === "rascunho" ? (canEdit ? <QuoteEditor key={`${open.id}-${open.revision}`} order={order} draft={open} reload={reload} /> : (
        <section className="card" aria-labelledby="h-rasc"><h2 id="h-rasc">Rascunho da versão {open.number}</h2><QuoteSummary quote={open} /></section>
      )) : null}
      {open?.state === "enviado" ? (
        <>
          <section className="card" aria-labelledby="h-env">
            <h2 id="h-env">Versão {open.number}: enviada, aguardando decisão</h2>
            <QuoteSummary quote={open} />
            <p><a href={`/api/v1/quotes/${open.id}/document`}>Orçamento (PDF)</a></p>
            {can("quote.manage") ? (
              <p>
                <button type="button" disabled={busy} onClick={() => { if (window.confirm("Revisar cria uma nova versão e a atual deixa de valer. Continuar?")) void run(() => api(`/quotes/${open.id}/revise`, { method: "POST", body: {} }), "Nova versão criada para edição.").then((r) => r.ok && reload()); }}>
                  Revisar (nova versão)
                </button>
              </p>
            ) : null}
            <Message message={message} />
          </section>
          {can("quote.decision.in_person") ? <DecisionForm quote={open} reload={reload} /> : null}
        </>
      ) : null}
      {past.length > 0 ? (
        <section className="card" aria-labelledby="h-vers" style={{ marginTop: 16 }}>
          <h2 id="h-vers">Versões anteriores</h2>
          <DataTable
            caption="Histórico de versões do orçamento"
            rows={past}
            rowKey={(q) => q.id}
            empty=""
            columns={[
              { header: "Versão", render: (q) => `v${q.number}` },
              { header: "Situação", render: (q) => <span className="badge">{QUOTE_STATE_LABEL[q.state] ?? "Rascunho"}</span> },
              { header: "Total", render: (q) => formatBrl(q.totalCents) },
              { header: "Decisão", render: (q) => (q.decision ? `${q.decision.decision === "aprovado" ? "Aprovado" : "Recusado"} por ${q.decision.confirmedByName} (presencial)` : "—") },
              { header: "Documentos", render: (q) => (q.state === "rascunho" ? "—" : (
                <>
                  <a href={`/api/v1/quotes/${q.id}/document`}>Orçamento</a>{q.decision ? <> · <a href={`/api/v1/quotes/${q.id}/approval-record`}>Registro de decisão</a></> : null}
                </>
              )) },
            ]}
          />
        </section>
      ) : null}
    </>
  );
}
