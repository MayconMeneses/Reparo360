import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { DataTable } from "../components/parts";
import { formatDateTime } from "../format";
import { Message, SelectField, TextArea, useAction } from "../ui/form";
import { NATURE_LABEL } from "./labels";
import type { TabProps } from "./types";

type Nature = "suspeita" | "confirmado" | "inconclusivo";

function DiagnosisForm({ order, reload }: TabProps) {
  const [nature, setNature] = useState<Nature>("confirmado");
  const [symptoms, setSymptoms] = useState("");
  const [checks, setChecks] = useState("");
  const [findings, setFindings] = useState("");
  const [services, setServices] = useState("");
  const { run, busy, message } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(() => api(`/work-orders/${order.id}/diagnostics`, {
      method: "POST",
      body: { nature, symptoms, checksPerformed: checks, findings: findings || undefined, recommendedServices: services || undefined },
    }), "Diagnóstico registrado.");
    if (result.ok) { setSymptoms(""); setChecks(""); setFindings(""); setServices(""); reload(); }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card" style={{ maxWidth: 640 }} aria-labelledby="h-novo-diag">
      <h2 id="h-novo-diag">Registrar diagnóstico</h2>
      <p className="muted">Cada registro é uma nova revisão: o anterior fica guardado.</p>
      <SelectField label="Natureza" value={nature} onChange={setNature} hint="Suspeita não é diagnóstico confirmado; inconclusivo não sustenta orçamento."
        options={[{ value: "confirmado", label: "Confirmado" }, { value: "suspeita", label: "Suspeita" }, { value: "inconclusivo", label: "Inconclusivo" }]} />
      <TextArea label="Sintomas observados" value={symptoms} onChange={setSymptoms} required />
      <TextArea label="Verificações realizadas" value={checks} onChange={setChecks} required />
      <TextArea label="Defeito identificado" value={findings} onChange={setFindings} required={nature !== "inconclusivo"} hint={nature === "inconclusivo" ? "Opcional quando inconclusivo." : "Obrigatório para suspeita e confirmado."} />
      <TextArea label="Serviços recomendados (opcional)" value={services} onChange={setServices} />
      <Message message={message} />
      <p><button type="submit" className="primary" disabled={busy}>{busy ? "Salvando…" : "Registrar diagnóstico"}</button></p>
    </form>
  );
}

export function DiagnosisTab({ order, reload }: TabProps) {
  const { can } = useAuth();
  return (
    <>
      {order.state === "EM_DIAGNOSTICO" && can("diagnostic.write") ? <DiagnosisForm order={order} reload={reload} /> : (
        <p className="muted">O diagnóstico é registrado enquanto a OS está em diagnóstico.</p>
      )}
      <div style={{ marginTop: 16 }}>
        <DataTable
          caption="Revisões do diagnóstico"
          rows={order.diagnostics}
          rowKey={(d) => d.id}
          empty="Nenhum diagnóstico registrado."
          columns={[
            { header: "Revisão", render: (d) => `#${d.revision}` },
            { header: "Natureza", render: (d) => <span className="badge">{NATURE_LABEL[d.nature] ?? d.nature}</span> },
            { header: "Defeito", render: (d) => d.findings ?? "—" },
            { header: "Sintomas e verificações", render: (d) => `${d.symptoms} · ${d.checksPerformed}` },
            { header: "Registrado em", render: (d) => formatDateTime(d.createdAt) },
          ]}
        />
      </div>
    </>
  );
}
