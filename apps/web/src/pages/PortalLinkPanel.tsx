import { useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { Qr } from "../components/Qr";
import { formatDateTime } from "../format";

/**
 * Gera o link de acompanhamento do cliente. O token só existe nesta resposta (no servidor fica o hash),
 * então o link é mostrado UMA vez, com QR para imprimir ou mostrar; gerar outro revoga o anterior.
 */
export function PortalLinkPanel({ orderId, closed }: { orderId: string; closed: boolean }) {
  const { can } = useAuth();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can("customer_access.manage")) return null;

  async function generate() {
    setBusy(true);
    setMessage(null);
    try {
      const created = await api<{ path: string; expiresAt: string }>(`/work-orders/${orderId}/portal-link`, { method: "POST", body: {} });
      setLink({ url: `${window.location.origin}${created.path}`, expiresAt: created.expiresAt });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof ApiError ? error.message : "Falha de conexão." });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/work-orders/${orderId}/portal-link`, { method: "DELETE" });
      setLink(null);
      setMessage({ kind: "ok", text: "Link revogado. O endereço antigo deixou de funcionar." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof ApiError ? error.message : "Falha de conexão." });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setMessage({ kind: "ok", text: "Link copiado." });
    } catch {
      setMessage({ kind: "error", text: "Não foi possível copiar. Selecione o endereço e copie manualmente." });
    }
  }

  return (
    <section className="card" aria-labelledby="h-portal" style={{ marginTop: 16 }}>
      <h2 id="h-portal">Link para o cliente acompanhar</h2>
      <p className="muted">O cliente vê a situação, a linha do tempo e o orçamento. Não vê dados internos nem decide pelo link.</p>
      {closed ? <p className="muted">Esta OS está encerrada: não é possível gerar novo link.</p> : (
        <div className="actions">
          <button type="button" className="primary" onClick={() => void generate()} disabled={busy}>{link ? "Gerar outro link (revoga o atual)" : "Gerar link"}</button>
          <button type="button" onClick={() => void revoke()} disabled={busy}>Revogar link</button>
        </div>
      )}
      {link ? (
        <div style={{ marginTop: 12 }}>
          <p>Mostrado uma única vez; copie ou imprima agora. Válido até {formatDateTime(link.expiresAt)}.</p>
          <label htmlFor="portal-url">Endereço do link</label>
          <input id="portal-url" readOnly value={link.url} onFocus={(event) => event.currentTarget.select()} />
          <p><button type="button" onClick={() => void copy()}>Copiar link</button></p>
          <Qr value={link.url} label="QR Code do link de acompanhamento do cliente" size={200} />
        </div>
      ) : null}
      {message ? <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "error" : undefined}>{message.text}</p> : null}
    </section>
  );
}
