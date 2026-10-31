import { Link } from "react-router-dom";
import { DataTable, Remote } from "../components/parts";
import { formatBrl, formatDateTime, QUOTE_STATE_LABEL } from "../format";
import { useApi } from "../useApi";

export function DevicesPage() {
  const state = useApi<{ devices: Array<{ id: string; category: string; brand: string; model: string; serialNumber: string | null; customerName: string }> }>("/devices?limit=50");
  return (
    <>
      <h1>Equipamentos</h1>
      <Remote state={state} onRetry={state.reload}>
        {({ devices }) => (
          <DataTable
            caption="Equipamentos cadastrados"
            rows={devices}
            rowKey={(r) => r.id}
            empty="Nenhum equipamento cadastrado."
            columns={[
              { header: "Categoria", render: (r) => r.category },
              { header: "Marca e modelo", render: (r) => `${r.brand} ${r.model}` },
              { header: "Número de série", render: (r) => r.serialNumber ?? "—" },
              { header: "Cliente", render: (r) => r.customerName },
            ]}
          />
        )}
      </Remote>
    </>
  );
}

export function QuotesPage() {
  const state = useApi<{ quotes: Array<{ id: string; number: number; state: string; totalCents: number; validUntil: string | null; workOrderId: string; protocol: string; customerName: string }> }>("/quotes?limit=50");
  return (
    <>
      <h1>Orçamentos</h1>
      <p className="muted">Mostra versões enviadas ou já decididas. Rascunhos ficam dentro de cada ordem.</p>
      <Remote state={state} onRetry={state.reload}>
        {({ quotes }) => (
          <DataTable
            caption="Orçamentos enviados e decididos"
            rows={quotes}
            rowKey={(r) => r.id}
            empty="Nenhum orçamento enviado ainda."
            columns={[
              { header: "Ordem", render: (r) => <Link to={`/ordens/${r.workOrderId}`}>{r.protocol}</Link> },
              { header: "Versão", render: (r) => `v${r.number}` },
              { header: "Situação", render: (r) => <span className="badge">{QUOTE_STATE_LABEL[r.state] ?? r.state}</span> },
              { header: "Total", render: (r) => formatBrl(r.totalCents) },
              { header: "Válido até", render: (r) => formatDateTime(r.validUntil) },
              { header: "Cliente", render: (r) => r.customerName },
            ]}
          />
        )}
      </Remote>
    </>
  );
}
