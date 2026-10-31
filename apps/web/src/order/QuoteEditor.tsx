import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { formatBrl } from "../format";
import { Message, SelectField, TextArea, TextField, useAction } from "../ui/form";
import { centsToInput, parseMoneyToCents } from "../ui/money";
import type { OrderDetail, Quote } from "./types";

interface Row { kind: "peca" | "servico"; description: string; quantity: string; price: string }

const emptyRow = (): Row => ({ kind: "servico", description: "", quantity: "1", price: "" });
const rowsOf = (quote: Quote | null): Row[] =>
  quote && quote.items.length > 0 ? quote.items.map((i) => ({ kind: i.kind, description: i.description, quantity: String(i.quantity), price: centsToInput(i.unitPriceCents) })) : [emptyRow()];

/** Converte as linhas digitadas em itens do servidor. Inválido devolve null: nada é enviado "adivinhado". */
function toItems(rows: Row[]) {
  const items = rows.map((r) => {
    const unitPriceCents = parseMoneyToCents(r.price);
    const quantity = /^\d{1,4}$/.test(r.quantity.trim()) ? Number(r.quantity) : NaN;
    return r.description.trim().length >= 2 && unitPriceCents !== null && quantity >= 1 && quantity <= 1000
      ? { kind: r.kind, description: r.description.trim(), quantity, unitPriceCents }
      : null;
  });
  return items.every((i) => i !== null) ? (items as NonNullable<(typeof items)[number]>[]) : null;
}

export function QuoteEditor({ order, draft, reload }: { order: OrderDetail; draft: Quote | null; reload: () => void }) {
  const { can } = useAuth();
  const [rows, setRows] = useState<Row[]>(() => rowsOf(draft));
  const [discount, setDiscount] = useState(draft ? centsToInput(draft.discountCents) : "0");
  const [terms, setTerms] = useState(draft?.paymentTerms ?? "");
  const [days, setDays] = useState(draft?.estimatedDays ? String(draft.estimatedDays) : "");
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [validity, setValidity] = useState("7");
  const [authorize, setAuthorize] = useState(false);
  const { run, busy, message, setMessage } = useAction();

  const items = toItems(rows);
  const discountCents = parseMoneyToCents(discount);
  const subtotal = items ? items.reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0) : null;
  const total = subtotal !== null && discountCents !== null && discountCents <= subtotal ? subtotal - discountCents : null;
  const suspicion = order.diagnostics[0]?.nature === "suspeita";

  const body = () => ({
    items,
    discountCents,
    paymentTerms: terms.trim() || undefined,
    estimatedDays: /^\d{1,3}$/.test(days.trim()) ? Number(days) : undefined,
    notes: notes.trim() || undefined,
  });

  async function save(): Promise<Quote | null> {
    if (!items || discountCents === null) { setMessage({ kind: "error", text: "Confira os itens: descrição, quantidade (1 a 1000) e preço em reais." }); return null; }
    const result = await run(() => (draft
      ? api<Quote>(`/quotes/${draft.id}`, { method: "PUT", body: { ...body(), revision: draft.revision } })
      : api<Quote>(`/work-orders/${order.id}/quotes`, { method: "POST", body: body() })), "Rascunho salvo.");
    return result.ok ? result.value : null;
  }

  async function saveAndSubmit() {
    const saved = await save();
    if (!saved) return;
    await run(() => api(`/quotes/${saved.id}/submit`, {
      method: "POST", body: { revision: saved.revision, validityDays: /^\d{1,2}$/.test(validity) ? Number(validity) : undefined, authorizeSuspicion: authorize },
    }), "Orçamento enviado ao cliente (aguardando decisão).");
    reload();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save().then((q) => q && reload()); }} className="card" aria-labelledby="h-orc-ed">
      <h2 id="h-orc-ed">{draft ? `Rascunho da versão ${draft.number}` : "Novo orçamento"}</h2>
      <p className="muted">Os totais são recalculados pelo servidor. Depois de enviado, o conteúdo não pode ser alterado (só revisado em nova versão).</p>
      {rows.map((row, index) => (
        <fieldset key={index} style={{ border: "1px solid var(--border)", borderRadius: 10, margin: "8px 0", padding: 12 }}>
          <legend>Item {index + 1}</legend>
          <div className="actions" style={{ alignItems: "flex-end" }}>
            <div style={{ minWidth: 130 }}><SelectField label="Tipo" value={row.kind} onChange={(kind) => setRows((c) => c.map((r, i) => (i === index ? { ...r, kind } : r)))} options={[{ value: "servico", label: "Serviço" }, { value: "peca", label: "Peça" }]} /></div>
            <div style={{ minWidth: 220, flex: 1 }}><TextField label="Descrição" value={row.description} onChange={(description) => setRows((c) => c.map((r, i) => (i === index ? { ...r, description } : r)))} /></div>
            <div style={{ width: 100 }}><TextField label="Qtd." value={row.quantity} inputMode="numeric" onChange={(quantity) => setRows((c) => c.map((r, i) => (i === index ? { ...r, quantity } : r)))} /></div>
            <div style={{ width: 140 }}><TextField label="Preço unit. (R$)" value={row.price} inputMode="decimal" onChange={(price) => setRows((c) => c.map((r, i) => (i === index ? { ...r, price } : r)))} /></div>
            <button type="button" onClick={() => setRows((c) => (c.length > 1 ? c.filter((_, i) => i !== index) : c))} disabled={rows.length === 1} aria-label={`Remover item ${index + 1}`}>Remover</button>
          </div>
        </fieldset>
      ))}
      <p><button type="button" onClick={() => setRows((c) => [...c, emptyRow()])} disabled={rows.length >= 50}>Adicionar item</button></p>
      <div className="grid">
        <TextField label="Desconto (R$)" value={discount} onChange={setDiscount} inputMode="decimal" hint="O limite depende do seu papel." />
        <TextField label="Previsão de execução (dias)" value={days} onChange={setDays} inputMode="numeric" />
      </div>
      <TextField label="Condições de pagamento" value={terms} onChange={setTerms} />
      <TextArea label="Observações (opcional)" value={notes} onChange={setNotes} />
      <p aria-live="polite"><strong>Estimativa:</strong> subtotal {subtotal === null ? "—" : formatBrl(subtotal)} · total {total === null ? "—" : formatBrl(total)} <span className="muted">(o servidor confirma)</span></p>
      {can("quote.submit") ? (
        <div className="card" style={{ marginBottom: 12 }}>
          <TextField label="Validade do orçamento (dias, 1 a 30)" value={validity} onChange={setValidity} inputMode="numeric" />
          {suspicion ? (
            <label style={{ fontWeight: 400, display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
              <input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={authorize} onChange={(e) => setAuthorize(e.target.checked)} />
              O diagnóstico é apenas uma suspeita e eu autorizo orçar assim mesmo (fica registrado)
            </label>
          ) : null}
        </div>
      ) : <p className="muted">Você pode montar o rascunho; o envio ao cliente é feito por atendente, gerente ou proprietário.</p>}
      <Message message={message} />
      <p className="actions">
        <button type="submit" disabled={busy}>Salvar rascunho</button>
        {can("quote.submit") ? <button type="button" className="primary" disabled={busy} onClick={() => void saveAndSubmit()}>Salvar e enviar ao cliente</button> : null}
      </p>
    </form>
  );
}
