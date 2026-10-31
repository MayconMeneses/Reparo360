import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { formatDateTime } from "../format";
import { Message, SelectField, TextField, useAction } from "../ui/form";
import { TEST_LABEL } from "./labels";
import type { TabProps } from "./types";

type Result = "aprovado" | "reprovado" | "nao_testado" | "nao_aplicavel";
const DEFAULT_ITEMS = ["Liga e inicia", "Tela e toque", "Carga", "Áudio", "Câmeras", "Conectividade"];
const OPTIONS = [{ value: "nao_testado", label: "Não testado" }, { value: "aprovado", label: "Aprovado" }, { value: "reprovado", label: "Reprovado" }, { value: "nao_aplicavel", label: "Não se aplica" }] as const;

interface Evaluation { round: number; approvable: boolean; hasFailure: boolean; reasons: string[] }

function TestsForm({ order, reload }: TabProps) {
  const last = order.testRounds[0];
  const [rows, setRows] = useState<Array<{ item: string; result: Result; note: string }>>(() =>
    (last?.results.length ? last.results.map((r) => r.item) : DEFAULT_ITEMS).map((item) => ({ item, result: "nao_testado" as Result, note: "" })));
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const { run, busy, message } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(() => api<Evaluation>(`/work-orders/${order.id}/test-checks`, {
      method: "POST", body: { items: rows.map((r) => ({ item: r.item, result: r.result, note: r.note || undefined })) },
    }), "Rodada de testes registrada.");
    if (result.ok) { setEvaluation(result.value); reload(); }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card" style={{ maxWidth: 720 }} aria-labelledby="h-novo-teste">
      <h2 id="h-novo-teste">Registrar rodada de testes</h2>
      <p className="muted">Para liberar: ao menos um item aprovado, nenhum reprovado e nenhum "não testado" (use "Não se aplica"). Cada envio é uma nova rodada; vale a última.</p>
      {rows.map((row, index) => (
        <fieldset key={row.item} style={{ border: 0, padding: 0, margin: "8px 0" }}>
          <legend><strong>{row.item}</strong></legend>
          <div className="actions" style={{ alignItems: "flex-end" }}>
            <div style={{ minWidth: 180 }}>
              <SelectField label="Resultado" value={row.result} onChange={(value) => setRows((cur) => cur.map((r, i) => (i === index ? { ...r, result: value } : r)))} options={[...OPTIONS]} />
            </div>
            <div style={{ minWidth: 220, flex: 1 }}>
              <TextField label="Observação (opcional)" value={row.note} onChange={(value) => setRows((cur) => cur.map((r, i) => (i === index ? { ...r, note: value } : r)))} />
            </div>
          </div>
        </fieldset>
      ))}
      <Message message={message} />
      {evaluation ? (
        <p role="status">{evaluation.approvable ? "Esta rodada permite liberar para retirada. Use \"Aprovar testes\" nas ações da ordem." : `Esta rodada ainda não libera: ${evaluation.reasons.join("; ")}.`}</p>
      ) : null}
      <p><button type="submit" className="primary" disabled={busy}>{busy ? "Salvando…" : "Registrar rodada"}</button></p>
    </form>
  );
}

export function TestsTab({ order, reload }: TabProps) {
  const { can } = useAuth();
  return (
    <>
      {order.state === "EM_TESTE" && can("test_checklist.write") ? <TestsForm order={order} reload={reload} /> : <p className="muted">Os testes finais são registrados enquanto a OS está em teste.</p>}
      <h2 style={{ marginTop: 16 }}>Rodadas anteriores</h2>
      {order.testRounds.length === 0 ? <p className="state muted">Nenhuma rodada de testes registrada.</p> : order.testRounds.map((round) => (
        <section key={round.round} className="card" style={{ marginTop: 8 }} aria-label={`Rodada ${round.round}`}>
          <h3 style={{ margin: 0 }}>Rodada {round.round} (ciclo {round.cycle}) · {formatDateTime(round.createdAt)}</h3>
          <ul>{round.results.map((r) => <li key={r.item}>{r.item}: {TEST_LABEL[r.result] ?? r.result}{r.note ? ` (${r.note})` : ""}</li>)}</ul>
        </section>
      ))}
    </>
  );
}
