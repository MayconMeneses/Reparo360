import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { PortalLinkPanel } from "../pages/PortalLinkPanel";
import type { TabProps } from "./types";

export function DocumentsTab({ order }: TabProps) {
  const { can } = useAuth();
  const closed = order.state === "ENCERRADA" || order.state === "CANCELADA";
  const sent = order.quotes.filter((q) => q.state !== "rascunho");
  return (
    <>
      {can("document.generate") ? (
        <section className="card" aria-labelledby="h-docs">
          <h2 id="h-docs">Documentos (PDF)</h2>
          <p className="muted">Gerados na hora a partir dos dados registrados. Nenhum é documento fiscal.</p>
          <ul>
            <li><a href={`/api/v1/work-orders/${order.id}/documents/receipt`}>Comprovante de recebimento</a></li>
            <li><a href={`/api/v1/work-orders/${order.id}/documents/sheet`}>Ordem de serviço</a></li>
            {sent.map((q) => (
              <li key={q.id}>
                Orçamento v{q.number}: <a href={`/api/v1/quotes/${q.id}/document`}>PDF</a>
                {q.decision ? <> · <a href={`/api/v1/quotes/${q.id}/approval-record`}>Registro de decisão</a></> : null}
              </li>
            ))}
            {order.delivery ? <li><a href={`/api/v1/work-orders/${order.id}/documents/delivery`}>Comprovante de entrega</a></li> : null}
          </ul>
          <p><Link to={`/etiqueta/${order.id}`}>Etiqueta com QR Code (uso interno)</Link></p>
        </section>
      ) : <p className="muted">Você não tem permissão para emitir documentos.</p>}
      <PortalLinkPanel orderId={order.id} closed={closed} />
    </>
  );
}
