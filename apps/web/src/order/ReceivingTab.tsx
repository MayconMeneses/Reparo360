import { useRef } from "react";
import { api, apiUpload } from "../api";
import { useAuth } from "../auth";
import { DataTable } from "../components/parts";
import { formatDateTime } from "../format";
import { Message, useAction } from "../ui/form";
import { CHECKLIST_LABEL } from "./labels";
import type { TabProps } from "./types";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const CLOSED = new Set(["ENCERRADA", "CANCELADA"]);

function Attachments({ order, reload }: TabProps) {
  const { can } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const { run, busy, message, setMessage } = useAction();
  const closed = CLOSED.has(order.state);

  async function upload(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) { setMessage({ kind: "error", text: "O arquivo passa de 8 MB. Reduza a foto e tente de novo." }); return; }
    const result = await run(() => apiUpload(`/work-orders/${order.id}/attachments`, file), "Arquivo enviado.");
    if (input.current) input.current.value = "";
    if (result.ok) reload();
  }

  return (
    <section className="card" aria-labelledby="h-anexos" style={{ marginTop: 16 }}>
      <h2 id="h-anexos">Fotos e anexos</h2>
      <DataTable
        caption="Arquivos da ordem"
        rows={order.attachments}
        rowKey={(a) => a.id}
        empty="Nenhum arquivo anexado."
        columns={[
          { header: "Arquivo", render: (a) => <a href={`/api/v1/attachments/${a.id}`}>{a.contentType === "application/pdf" ? "PDF" : "Foto"} de {formatDateTime(a.createdAt)}</a> },
          { header: "Tamanho", render: (a) => `${Math.max(1, Math.round(a.sizeBytes / 1024))} KB` },
          {
            header: "Ação",
            render: (a) => can("attachment.delete") && !closed
              ? <button type="button" disabled={busy} onClick={() => { if (window.confirm("Remover este anexo? O arquivo é preservado, mas some da lista.")) void run(() => api(`/attachments/${a.id}`, { method: "DELETE" }), "Anexo removido.").then((r) => r.ok && reload()); }}>Remover</button>
              : "—",
          },
        ]}
      />
      {can("attachment.upload") && !closed ? (
        <div style={{ marginTop: 12 }}>
          <label htmlFor="file">Adicionar foto ou PDF (até 8 MB)</label>
          {/* capture abre a câmera traseira em celulares; em computadores abre o seletor de arquivos. */}
          <input id="file" ref={input} type="file" accept={ACCEPT} capture="environment" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
      ) : null}
      <Message message={message} />
    </section>
  );
}

export function ReceivingTab({ order, reload }: TabProps) {
  const insp = order.inspection;
  return (
    <>
      <section className="card" aria-labelledby="h-rec">
        <h2 id="h-rec">Recebimento</h2>
        {insp ? (
          <>
            <p><strong>Recebido em:</strong> {formatDateTime(insp.receivedAt)}</p>
            <p><strong>Estado físico:</strong> {insp.physicalCondition}</p>
            <p><strong>Acessórios:</strong> {insp.accessories.join(", ") || "nenhum informado"}</p>
            <p><strong>Senha do aparelho informada:</strong> {insp.passwordInformed ? "sim" : "não"}</p>
            <DataTable
              caption="Checklist de entrada"
              rows={insp.checklist}
              rowKey={(c) => c.item}
              empty="Nenhum item registrado."
              columns={[{ header: "Item", render: (c) => c.item }, { header: "Resultado", render: (c) => CHECKLIST_LABEL[c.result] ?? c.result }]}
            />
          </>
        ) : <p className="muted">Sem registro de recebimento.</p>}
      </section>
      <Attachments order={order} reload={reload} />
    </>
  );
}
