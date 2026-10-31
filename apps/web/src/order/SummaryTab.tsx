import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { formatDateTime, formatPhone } from "../format";
import { Message, SelectField, useAction } from "../ui/form";
import { useApi } from "../useApi";
import type { TabProps } from "./types";

const CLOSED = new Set(["ENTREGUE", "ENCERRADA", "CANCELADA"]);

function TechnicianAssign({ order, reload }: TabProps) {
  const technicians = useApi<{ technicians: Array<{ id: string; name: string }> }>("/technicians");
  const [value, setValue] = useState(order.technicianId ?? "");
  const { run, busy, message } = useAction();
  if (technicians.status !== "ready") return null;
  const current = technicians.data.technicians.find((t) => t.id === order.technicianId);

  return (
    <div style={{ marginTop: 12 }}>
      <p><strong>Técnico:</strong> {order.technicianId ? current?.name ?? "atribuído" : "ainda não atribuído"}</p>
      <div className="actions">
        <div style={{ minWidth: 240 }}>
          <SelectField label="Atribuir técnico" value={value} onChange={setValue} options={[{ value: "", label: "Sem técnico" }, ...technicians.data.technicians.map((t) => ({ value: t.id, label: t.name }))]} />
        </div>
        <button type="button" disabled={busy || value === (order.technicianId ?? "")}
          onClick={() => void run(() => api(`/work-orders/${order.id}/technician`, { method: "PATCH", body: { technicianId: value || null, version: order.version } }), "Técnico atualizado.").then((r) => r.ok && reload())}>
          Salvar técnico
        </button>
      </div>
      <Message message={message} />
    </div>
  );
}

export function SummaryTab({ order, reload }: TabProps) {
  const { can } = useAuth();
  return (
    <>
      <div className="grid">
        <section className="card" aria-labelledby="h-cli">
          <h2 id="h-cli">Cliente</h2>
          {order.customer ? <p><Link to={`/clientes/${order.customer.id}`}>{order.customer.name}</Link></p> : <p>—</p>}
          {order.customer?.phone ? <p>{formatPhone(order.customer.phone)}</p> : null}
          {order.customer?.email ? <p className="muted">{order.customer.email}</p> : null}
        </section>
        <section className="card" aria-labelledby="h-dev">
          <h2 id="h-dev">Equipamento</h2>
          <p>{order.device ? `${order.device.brand} ${order.device.model}` : "—"}</p>
          <p className="muted">{order.device?.category}{order.device?.color ? ` · ${order.device.color}` : ""}</p>
          {order.device?.serialNumber ? <p className="muted">Série {order.device.serialNumber}</p> : null}
          {order.device?.imei ? <p className="muted">IMEI {order.device.imei}</p> : null}
        </section>
      </div>
      <section className="card" aria-labelledby="h-def" style={{ marginTop: 16 }}>
        <h2 id="h-def">Atendimento</h2>
        <p><strong>Defeito relatado:</strong> {order.reportedDefect}</p>
        <p><strong>Prioridade:</strong> {order.priority} · <strong>Aberta em:</strong> {formatDateTime(order.createdAt)}</p>
        {order.origin ? <p>Retorno da ordem <Link to={`/ordens/${order.origin.id}`}>{order.origin.protocol}</Link></p> : null}
        {can("work_order.assign") && !CLOSED.has(order.state) ? <TechnicianAssign order={order} reload={reload} /> : null}
      </section>
    </>
  );
}
