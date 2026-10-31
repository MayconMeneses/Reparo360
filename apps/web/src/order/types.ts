export interface QuoteItem { kind: "peca" | "servico"; description: string; quantity: number; unitPriceCents: number }

export interface Quote {
  id: string;
  number: number;
  state: "rascunho" | "enviado" | "aprovado" | "recusado" | "expirado" | "substituido";
  revision: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paymentTerms: string | null;
  estimatedDays: number | null;
  notes: string | null;
  validUntil: string | null;
  items: QuoteItem[];
  decision: { decision: string; channel: string; confirmedByName: string; note: string | null; partUnavailable: boolean; decidedAt: string } | null;
}

export interface OrderDetail {
  id: string;
  protocol: string;
  state: string;
  priority: string;
  reportedDefect: string;
  technicianId: string | null;
  version: number;
  repairCycle: number;
  testCycle: number;
  createdAt: string;
  customer: { id: string; name: string; phone?: string; email?: string | null } | null;
  device: { id: string; category: string; brand: string; model: string; color: string | null; serialNumber: string | null; imei: string | null } | null;
  inspection: { physicalCondition: string; accessories: string[]; checklist: Array<{ item: string; result: string }>; passwordInformed: boolean; receivedAt: string } | null;
  events: Array<{ type: string; fromState: string | null; toState: string | null; reason: string | null; createdAt: string }>;
  attachments: Array<{ id: string; contentType: string; sizeBytes: number; createdAt: string }>;
  diagnostics: Array<{ id: string; revision: number; nature: "suspeita" | "confirmado" | "inconclusivo"; symptoms: string; checksPerformed: string; findings: string | null; recommendedServices: string | null; createdAt: string }>;
  quotes: Quote[];
  repairs: Array<{ id: string; cycle: number; procedure: string; partsUsed: string | null; outcome: string; notes: string | null; createdAt: string }>;
  testRounds: Array<{ round: number; cycle: number; createdAt: string; results: Array<{ item: string; result: string; note: string | null }> }>;
  delivery: { pickedUpByName: string; confirmationMethod: string; itemsReturned: string[]; note: string | null; deliveredAt: string } | null;
  origin: { id: string; protocol: string } | null;
}

/** Entregue pelo painel da OS para cada aba: dados, papel e como recarregar depois de uma mudança. */
export interface TabProps {
  order: OrderDetail;
  reload: () => void;
}
