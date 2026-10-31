import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Remote } from "../components/parts";
import { formatDateTime, stateLabel } from "../format";
import { ActionsBar } from "../order/ActionsBar";
import { DeliveryTab } from "../order/DeliveryTab";
import { DiagnosisTab } from "../order/DiagnosisTab";
import { DocumentsTab } from "../order/DocumentsTab";
import { HistoryTab } from "../order/HistoryTab";
import { QuoteTab } from "../order/QuoteTab";
import { ReceivingTab } from "../order/ReceivingTab";
import { RepairTab } from "../order/RepairTab";
import { SummaryTab } from "../order/SummaryTab";
import { TestsTab } from "../order/TestsTab";
import type { OrderDetail } from "../order/types";
import { Tabs } from "../ui/tabs";
import { useApi } from "../useApi";

export function OrderPage() {
  const { id } = useParams();
  const [tab, setTab] = useState("resumo");
  // Outra OS abre sempre no Resumo, não na aba da OS anterior.
  useEffect(() => { setTab("resumo"); }, [id]);
  const state = useApi<OrderDetail>(id ? `/work-orders/${encodeURIComponent(id)}` : null);

  return (
    <>
      <p><Link to="/ordens">← Voltar para as ordens</Link></p>
      <Remote state={state} onRetry={state.reload}>
        {(order) => {
          const props = { order, reload: state.reload };
          const tabs = [
            { id: "resumo", label: "Resumo" },
            { id: "recebimento", label: "Recebimento", badge: order.attachments.length ? String(order.attachments.length) : undefined },
            { id: "diagnostico", label: "Diagnóstico" },
            { id: "orcamento", label: "Orçamento" },
            { id: "reparo", label: "Reparo" },
            { id: "testes", label: "Testes" },
            { id: "entrega", label: "Entrega" },
            { id: "documentos", label: "Documentos" },
            { id: "historico", label: "Histórico" },
          ];
          return (
            <>
              <h1>Ordem {order.protocol}</h1>
              <p><span className="badge">{stateLabel(order.state)}</span> <span className="muted">aberta em {formatDateTime(order.createdAt)}</span></p>
              <ActionsBar {...props} />
              <Tabs tabs={tabs} active={tab} onChange={setTab}>
                {tab === "resumo" ? <SummaryTab {...props} /> : null}
                {tab === "recebimento" ? <ReceivingTab {...props} /> : null}
                {tab === "diagnostico" ? <DiagnosisTab {...props} /> : null}
                {tab === "orcamento" ? <QuoteTab {...props} /> : null}
                {tab === "reparo" ? <RepairTab {...props} /> : null}
                {tab === "testes" ? <TestsTab {...props} /> : null}
                {tab === "entrega" ? <DeliveryTab {...props} /> : null}
                {tab === "documentos" ? <DocumentsTab {...props} /> : null}
                {tab === "historico" ? <HistoryTab {...props} /> : null}
              </Tabs>
            </>
          );
        }}
      </Remote>
    </>
  );
}
