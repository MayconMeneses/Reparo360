import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { DataTable, Remote } from "../components/parts";
import { formatDateTime, STATE_LABEL, stateLabel } from "../format";
import { SelectField, TextField } from "../ui/form";
import { useApi } from "../useApi";

interface Row { id: string; protocol: string; state: string; priority: string; customerName: string; device: { brand: string; model: string }; createdAt: string }

export function OrdersPage() {
  const { can } = useAuth();
  const [state, setState] = useState("");
  const [term, setTerm] = useState("");
  const [applied, setApplied] = useState("");
  const query = `?limit=50${state ? `&state=${state}` : ""}${applied ? `&q=${encodeURIComponent(applied)}` : ""}`;
  const data = useApi<{ workOrders: Row[] }>(`/work-orders${query}`);
  return (
    <>
      <h1>Ordens de serviço</h1>
      <form className="actions" role="search" onSubmit={(e) => { e.preventDefault(); setApplied(term.trim()); }}>
        <div style={{ minWidth: 200 }}><TextField label="Protocolo" value={term} onChange={setTerm} hint="Ex.: 2026-0001" /></div>
        <div style={{ minWidth: 220 }}>
          <SelectField label="Situação" value={state} onChange={setState} options={[{ value: "", label: "Todas" }, ...Object.entries(STATE_LABEL).map(([value, label]) => ({ value, label }))]} />
        </div>
        <button type="submit">Buscar</button>
        {can("work_order.create") ? <Link className="button primary" to="/ordens/nova" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Nova ordem</Link> : null}
      </form>
      <Remote state={data} onRetry={data.reload}>
        {({ workOrders }) => (
          <DataTable
            caption="Ordens de serviço"
            rows={workOrders}
            rowKey={(r) => r.id}
            empty="Nenhuma ordem encontrada."
            columns={[
              { header: "Protocolo", render: (r) => <Link to={`/ordens/${r.id}`}>{r.protocol}</Link> },
              { header: "Situação", render: (r) => <span className="badge">{stateLabel(r.state)}</span> },
              { header: "Cliente", render: (r) => r.customerName },
              { header: "Equipamento", render: (r) => `${r.device.brand} ${r.device.model}` },
              { header: "Aberta em", render: (r) => formatDateTime(r.createdAt) },
            ]}
          />
        )}
      </Remote>
    </>
  );
}
