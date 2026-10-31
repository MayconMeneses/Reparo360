import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { DataTable } from "../components/parts";
import { formatDateTime } from "../format";
import { Message, SelectField, TextArea, TextField, useAction } from "../ui/form";
import { OUTCOME_LABEL } from "./labels";
import type { TabProps } from "./types";

type Outcome = "concluido" | "parcial" | "sem_sucesso";

function RepairForm({ order, reload }: TabProps) {
  const [procedure, setProcedure] = useState("");
  const [parts, setParts] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("concluido");
  const [notes, setNotes] = useState("");
  const { run, busy, message } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(() => api(`/work-orders/${order.id}/repairs`, {
      method: "POST", body: { procedure, partsUsed: parts || undefined, outcome, notes: notes || undefined },
    }), "Reparo registrado.");
    if (result.ok) { setProcedure(""); setParts(""); setNotes(""); reload(); }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card" style={{ maxWidth: 640 }} aria-labelledby="h-novo-rep">
      <h2 id="h-novo-rep">Registrar procedimento</h2>
      <p className="muted">É preciso ao menos um registro neste ciclo para iniciar os testes finais.</p>
      <TextArea label="Procedimento realizado" value={procedure} onChange={setProcedure} required />
      <TextField label="Peças usadas (opcional)" value={parts} onChange={setParts} hint="Texto livre. O controle de estoque ainda não existe." />
      <SelectField label="Resultado" value={outcome} onChange={setOutcome} options={[{ value: "concluido", label: "Concluído" }, { value: "parcial", label: "Parcial" }, { value: "sem_sucesso", label: "Sem sucesso" }]} />
      <TextArea label="Observações (opcional)" value={notes} onChange={setNotes} />
      <Message message={message} />
      <p><button type="submit" className="primary" disabled={busy}>{busy ? "Salvando…" : "Registrar reparo"}</button></p>
    </form>
  );
}

export function RepairTab({ order, reload }: TabProps) {
  const { can } = useAuth();
  return (
    <>
      {order.state === "EM_REPARO" && can("repair.update") ? <RepairForm order={order} reload={reload} /> : (
        <p className="muted">O reparo é registrado enquanto a OS está em reparo.</p>
      )}
      <div style={{ marginTop: 16 }}>
        <DataTable
          caption="Procedimentos registrados"
          rows={order.repairs}
          rowKey={(r) => r.id}
          empty="Nenhum reparo registrado."
          columns={[
            { header: "Ciclo", render: (r) => `#${r.cycle}` },
            { header: "Procedimento", render: (r) => r.procedure },
            { header: "Peças", render: (r) => r.partsUsed ?? "—" },
            { header: "Resultado", render: (r) => OUTCOME_LABEL[r.outcome] ?? r.outcome },
            { header: "Registrado em", render: (r) => formatDateTime(r.createdAt) },
          ]}
        />
      </div>
    </>
  );
}
