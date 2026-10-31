import { Link, useParams } from "react-router-dom";
import { Qr } from "../components/Qr";
import { Remote } from "../components/parts";
import { stateLabel } from "../format";
import { useApi } from "../useApi";

interface Detail { protocol: string; state: string; device: { brand: string; model: string } | null }

/**
 * Etiqueta física. O QR leva ao endereço INTERNO da OS: quem escaneia sem login cai na tela de entrada e
 * não vê nada. Ele não é o link do cliente (esse é gerado à parte, com token individual).
 */
export function LabelPage() {
  const { id } = useParams();
  const state = useApi<Detail>(id ? `/work-orders/${encodeURIComponent(id)}` : null);
  return (
    <>
      <p className="no-print"><Link to={id ? `/ordens/${id}` : "/ordens"}>← Voltar para a ordem</Link></p>
      <h1 className="no-print">Etiqueta da ordem</h1>
      <Remote state={state} onRetry={state.reload}>
        {(o) => (
          <section className="label" aria-label={`Etiqueta da ordem ${o.protocol}`} style={{ border: "2px solid var(--control-border)", borderRadius: 10, padding: 16, maxWidth: 320 }}>
            <Qr value={`${window.location.origin}/ordens/${id}`} label={`QR Code da ordem ${o.protocol}`} size={160} />
            <p style={{ fontSize: "1.25rem", fontWeight: 700, margin: "8px 0 0" }}>{o.protocol}</p>
            <p style={{ margin: 0 }}>{o.device ? `${o.device.brand} ${o.device.model}` : ""}</p>
            <p className="muted" style={{ margin: 0 }}>{stateLabel(o.state)}</p>
          </section>
        )}
      </Remote>
      <p className="no-print"><button type="button" onClick={() => window.print()}>Imprimir etiqueta</button></p>
    </>
  );
}
