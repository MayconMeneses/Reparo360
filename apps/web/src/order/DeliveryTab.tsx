import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { formatDateTime } from "../format";
import { Message, SelectField, TextArea, TextField, useAction } from "../ui/form";
import { CONFIRMATION_LABEL } from "./labels";
import type { TabProps } from "./types";

type Method = "comprovante_apresentado" | "documento_conferido" | "outro";

function DeliveryForm({ order, reload }: TabProps) {
  const received = order.inspection?.accessories ?? [];
  const [name, setName] = useState(order.customer?.name ?? "");
  const [method, setMethod] = useState<Method>("comprovante_apresentado");
  const [returned, setReturned] = useState<string[]>(received);
  const [note, setNote] = useState("");
  const { run, busy, message } = useAction();
  const differs = returned.length !== received.length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(() => api(`/work-orders/${order.id}/delivery`, {
      method: "POST", body: { expectedVersion: order.version, pickedUpByName: name, confirmationMethod: method, itemsReturned: returned, note: note || undefined },
    }), "Entrega registrada.");
    if (result.ok || (result.error instanceof ApiError && result.error.code === "CONFLITO_DE_VERSAO")) reload();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card" style={{ maxWidth: 640 }} aria-labelledby="h-entrega">
      <h2 id="h-entrega">Registrar entrega</h2>
      <p className="muted">Não se coleta número de documento. A entrega e a mudança de situação acontecem juntas.</p>
      <TextField label="Quem retirou" value={name} onChange={setName} required />
      <SelectField label="Como foi confirmado" value={method} onChange={setMethod} options={[{ value: "comprovante_apresentado", label: CONFIRMATION_LABEL.comprovante_apresentado ?? "" }, { value: "documento_conferido", label: CONFIRMATION_LABEL.documento_conferido ?? "" }, { value: "outro", label: "Outro" }]} />
      <fieldset style={{ border: 0, padding: 0 }}>
        <legend><strong>Acessórios devolvidos</strong></legend>
        {received.length === 0 ? <p className="muted">Nenhum acessório foi recebido.</p> : received.map((item) => (
          <label key={item} style={{ fontWeight: 400, display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
            <input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={returned.includes(item)}
              onChange={(e) => setReturned((cur) => (e.target.checked ? [...cur, item] : cur.filter((i) => i !== item)))} />
            {item}
          </label>
        ))}
      </fieldset>
      <TextArea label={differs ? "Observação (obrigatória: acessórios diferentes dos recebidos)" : "Observação (opcional)"} value={note} onChange={setNote} required={differs} />
      <Message message={message} />
      <p><button type="submit" className="primary" disabled={busy || name.trim().length < 2 || (differs && note.trim().length < 3)}>{busy ? "Registrando…" : "Confirmar entrega"}</button></p>
    </form>
  );
}

export function DeliveryTab({ order, reload }: TabProps) {
  const { can } = useAuth();
  if (order.delivery) {
    const d = order.delivery;
    return (
      <section className="card" aria-labelledby="h-entregue">
        <h2 id="h-entregue">Entrega registrada</h2>
        <p><strong>Retirado por:</strong> {d.pickedUpByName}</p>
        <p><strong>Confirmação:</strong> {CONFIRMATION_LABEL[d.confirmationMethod] ?? d.confirmationMethod}</p>
        <p><strong>Acessórios devolvidos:</strong> {d.itemsReturned.join(", ") || "nenhum"}</p>
        {d.note ? <p><strong>Observação:</strong> {d.note}</p> : null}
        <p className="muted">{formatDateTime(d.deliveredAt)}</p>
        <p><a href={`/api/v1/work-orders/${order.id}/documents/delivery`}>Comprovante de entrega (PDF)</a></p>
      </section>
    );
  }
  const ready = order.state === "PRONTA_RETIRADA" || order.state === "PRONTA_RETIRADA_SEM_REPARO";
  if (ready && can("delivery.register")) return <DeliveryForm order={order} reload={reload} />;
  return <p className="state muted">A entrega fica disponível quando a OS estiver pronta para retirada.</p>;
}
