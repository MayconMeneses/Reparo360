import { formatBrl } from "./money.js";
import { dateTime, formatPhone, renderPdf } from "./pdf-layout.js";
import { CHECKLIST_LABEL } from "./receipt.pdf.js";

const NOT_FISCAL = "Este documento é um registro operacional e não é documento fiscal.";

const QUOTE_STATE_LABEL: Record<string, string> = {
  enviado: "Enviado, aguardando decisão",
  aprovado: "Aprovado",
  recusado: "Recusado",
  expirado: "Expirado",
  substituido: "Substituído por uma versão mais recente",
};

export interface QuotePrintData {
  number: number;
  state: string;
  items: Array<{ kind: string; description: string; quantity: number; unitPriceCents: number }>;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paymentTerms: string | null;
  estimatedDays: number | null;
  validUntil: Date | null;
  notes: string | null;
  submittedAt: Date | null;
}

export interface QuoteDocData {
  tenantName: string;
  protocol: string;
  customerName: string;
  deviceLabel: string;
  quote: QuotePrintData;
  issuedAt: Date;
}

export function buildQuotePdf(data: QuoteDocData): Promise<Buffer> {
  const q = data.quote;
  return renderPdf(
    { title: `Orçamento ${data.protocol} v${q.number}`, subject: data.protocol, issuedAt: data.issuedAt, footer: `${NOT_FISCAL} Valores em reais; o orçamento não registra pagamento.` },
    (p) => {
      p.title(data.tenantName, `Orçamento (versão ${q.number})`);
      // Versão antiga ou vencida nunca pode passar pela vigente.
      if (q.state === "substituido") p.banner("VERSÃO SUBSTITUÍDA: sem validade. Consulte a versão mais recente.");
      if (q.state === "expirado") p.banner("ORÇAMENTO EXPIRADO: sem validade.");
      p.field("Protocolo", data.protocol);
      p.field("Situação", QUOTE_STATE_LABEL[q.state] ?? q.state);
      if (q.submittedAt) p.field("Enviado em", dateTime(q.submittedAt));
      if (q.validUntil) p.field("Válido até", dateTime(q.validUntil));
      p.field("Cliente", data.customerName);
      p.field("Equipamento", data.deviceLabel);

      p.heading("Itens");
      for (const item of q.items) {
        const kind = item.kind === "peca" ? "Peça" : "Serviço";
        p.line(`${kind}: ${item.description}  |  ${item.quantity} x ${formatBrl(item.unitPriceCents)} = ${formatBrl(item.quantity * item.unitPriceCents)}`);
      }
      p.heading("Valores");
      p.field("Subtotal", formatBrl(q.subtotalCents));
      p.field("Desconto", formatBrl(q.discountCents));
      p.field("Total", formatBrl(q.totalCents));

      p.heading("Condições");
      p.field("Condições de pagamento", q.paymentTerms ?? "não informadas");
      p.field("Previsão de execução", q.estimatedDays ? `${q.estimatedDays} dia(s)` : "não informada");
      if (q.notes) p.field("Observações", q.notes);
    },
  );
}

export interface ApprovalDocData {
  tenantName: string;
  protocol: string;
  quoteNumber: number;
  totalCents: number;
  decision: string;
  confirmedByName: string;
  /** Nulo na decisão remota (ninguém da equipe registrou). */
  registeredByName: string | null;
  channel: string;
  decidedAt: Date;
  note: string | null;
  partUnavailable: boolean;
  issuedAt: Date;
}

export function buildApprovalPdf(data: ApprovalDocData): Promise<Buffer> {
  return renderPdf(
    { title: `Registro de decisão ${data.protocol} v${data.quoteNumber}`, subject: data.protocol, issuedAt: data.issuedAt, footer: NOT_FISCAL },
    (p) => {
      p.title(data.tenantName, "Registro de decisão sobre orçamento");
      p.field("Protocolo", data.protocol);
      p.field("Orçamento", `versão ${data.quoteNumber}, total ${formatBrl(data.totalCents)}`);
      p.field("Decisão", data.decision === "aprovado" ? "APROVADO" : "RECUSADO");
      if (data.channel === "remoto") {
        p.field("Forma", "Remota, confirmada por código enviado ao e-mail cadastrado do cliente");
        p.field("Decisão de", data.confirmedByName);
      } else {
        p.field("Forma", "Presencial, registrada por funcionário da assistência");
        p.field("Decisão informada por", data.confirmedByName);
        if (data.registeredByName) p.field("Registrada por", data.registeredByName);
      }
      p.field("Data e hora", dateTime(data.decidedAt));
      if (data.partUnavailable) p.field("Observação", "Peça indisponível no momento da aprovação");
      if (data.note) p.field("Anotação", data.note);
    },
  );
}

const CONFIRMATION_LABEL: Record<string, string> = {
  comprovante_apresentado: "Comprovante de recebimento apresentado",
  documento_conferido: "Documento conferido",
  outro: "Outro",
};

export interface DeliveryDocData {
  tenantName: string;
  protocol: string;
  customerName: string;
  deviceLabel: string;
  pickedUpByName: string;
  confirmationMethod: string;
  itemsReturned: string[];
  deliveredByName: string;
  deliveredAt: Date;
  note: string | null;
  issuedAt: Date;
}

export function buildDeliveryPdf(data: DeliveryDocData): Promise<Buffer> {
  return renderPdf(
    {
      title: `Comprovante de entrega ${data.protocol}`,
      subject: data.protocol,
      issuedAt: data.issuedAt,
      footer: `${NOT_FISCAL} Este comprovante registra a entrega do equipamento; não registra pagamento nem quitação.`,
    },
    (p) => {
      p.title(data.tenantName, "Comprovante de entrega");
      p.field("Protocolo", data.protocol);
      p.field("Entregue em", dateTime(data.deliveredAt));
      p.field("Entregue por", data.deliveredByName);
      p.field("Cliente", data.customerName);
      p.field("Equipamento", data.deviceLabel);
      p.heading("Retirada");
      p.field("Retirado por", data.pickedUpByName);
      p.field("Confirmação", CONFIRMATION_LABEL[data.confirmationMethod] ?? data.confirmationMethod);
      p.field("Acessórios devolvidos", data.itemsReturned.length > 0 ? data.itemsReturned.join(", ") : "nenhum");
      if (data.note) p.field("Observação", data.note);
    },
  );
}

export interface SheetData {
  tenantName: string;
  protocol: string;
  state: string;
  priority: string;
  openedAt: Date;
  customerName: string;
  customerPhone: string;
  deviceLabel: string;
  reportedDefect: string;
  physicalCondition: string;
  accessories: string[];
  checklist: Array<{ item: string; result: string }>;
  diagnostic: { nature: string; findings: string | null; revision: number } | null;
  quote: { number: number; state: string; totalCents: number } | null;
  repairs: Array<{ procedure: string; outcome: string; partsUsed: string | null; createdAt: Date }>;
  tests: Array<{ item: string; result: string }>;
  events: Array<{ type: string; createdAt: Date }>;
  issuedAt: Date;
}

const TEST_LABEL: Record<string, string> = { aprovado: "Aprovado", reprovado: "Reprovado", nao_testado: "Não testado", nao_aplicavel: "Não se aplica" };

export function buildSheetPdf(data: SheetData): Promise<Buffer> {
  return renderPdf(
    { title: `Ordem de serviço ${data.protocol}`, subject: data.protocol, issuedAt: data.issuedAt, footer: NOT_FISCAL },
    (p) => {
      p.title(data.tenantName, "Ordem de serviço");
      p.field("Protocolo", data.protocol);
      p.field("Situação", data.state);
      p.field("Prioridade", data.priority);
      p.field("Aberta em", dateTime(data.openedAt));
      p.field("Cliente", `${data.customerName} - ${formatPhone(data.customerPhone)}`);
      p.field("Equipamento", data.deviceLabel);

      p.heading("Recebimento");
      p.field("Defeito relatado", data.reportedDefect);
      p.field("Estado físico", data.physicalCondition);
      p.field("Acessórios", data.accessories.length > 0 ? data.accessories.join(", ") : "nenhum informado");
      for (const entry of data.checklist) p.line(`${entry.item}: ${CHECKLIST_LABEL[entry.result] ?? entry.result}`);

      p.heading("Diagnóstico");
      if (data.diagnostic) p.line(`Revisão ${data.diagnostic.revision} (${data.diagnostic.nature}): ${data.diagnostic.findings ?? "sem defeito identificado"}`);
      else p.line("Sem diagnóstico registrado.");

      p.heading("Orçamento");
      if (data.quote) p.line(`Versão ${data.quote.number} (${QUOTE_STATE_LABEL[data.quote.state] ?? data.quote.state}): ${formatBrl(data.quote.totalCents)}`);
      else p.line("Sem orçamento enviado.");

      p.heading("Reparo");
      if (data.repairs.length === 0) p.line("Nenhum reparo registrado.");
      for (const r of data.repairs) p.line(`${dateTime(r.createdAt)} - ${r.procedure} (${r.outcome})${r.partsUsed ? ` - peças: ${r.partsUsed}` : ""}`);

      p.heading("Testes finais (última rodada)");
      if (data.tests.length === 0) p.line("Nenhum teste registrado.");
      for (const t of data.tests) p.line(`${t.item}: ${TEST_LABEL[t.result] ?? t.result}`);

      p.heading("Histórico");
      for (const e of data.events) p.line(`${dateTime(e.createdAt)} - ${e.type}`);
    },
  );
}
