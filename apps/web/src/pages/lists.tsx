import { Link } from "react-router-dom";
import { DataTable, Remote } from "../components/parts";
import { formatBrl, formatDateTime, QUOTE_STATE_LABEL, ROLE_LABEL, stateLabel } from "../format";
import { useApi } from "../useApi";

export function OrdersPage() {
  const state = useApi<{ workOrders: Array<{ id: string; protocol: string; state: string; priority: string; customerName: string; device: { brand: string; model: string }; createdAt: string }> }>("/work-orders?limit=50");
  return (
    <>
      <h1>Ordens de serviço</h1>
      <Remote state={state} onRetry={state.reload}>
        {({ workOrders }) => (
          <DataTable
            caption="Ordens de serviço mais recentes"
            rows={workOrders}
            rowKey={(r) => r.id}
            empty="Nenhuma ordem de serviço ainda."
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

export function CustomersPage() {
  const state = useApi<{ customers: Array<{ id: string; name: string; phone: string; email: string | null; createdAt: string }> }>("/customers?limit=50");
  return (
    <>
      <h1>Clientes</h1>
      <Remote state={state} onRetry={state.reload}>
        {({ customers }) => (
          <DataTable
            caption="Clientes cadastrados"
            rows={customers}
            rowKey={(r) => r.id}
            empty="Nenhum cliente cadastrado."
            columns={[
              { header: "Nome", render: (r) => r.name },
              { header: "Telefone", render: (r) => r.phone },
              { header: "E-mail", render: (r) => r.email ?? "—" },
              { header: "Cadastro", render: (r) => formatDateTime(r.createdAt) },
            ]}
          />
        )}
      </Remote>
    </>
  );
}

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

export function TeamPage() {
  const state = useApi<{ members: Array<{ userId: string; name: string; email: string; role: string; status: string }> }>("/team");
  return (
    <>
      <h1>Equipe</h1>
      <Remote state={state} onRetry={state.reload}>
        {({ members }) => (
          <DataTable
            caption="Membros da equipe"
            rows={members}
            rowKey={(r) => r.userId}
            empty="Nenhum membro."
            columns={[
              { header: "Nome", render: (r) => r.name },
              { header: "E-mail", render: (r) => r.email },
              { header: "Papel", render: (r) => ROLE_LABEL[r.role] ?? r.role },
              { header: "Situação", render: (r) => (r.status === "ativo" ? "Ativo" : "Desativado") },
            ]}
          />
        )}
      </Remote>
    </>
  );
}
