import { schema, withContext, type Db } from "@reparo360/database";
import { isRestrictedToAssigned } from "@reparo360/domain";
import { and, asc, eq } from "drizzle-orm";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import type { AppServices } from "../../services.js";
import type { RequestMeta } from "../identity/auth.service.js";
import { listDiagnostics } from "../diagnostics/diagnostics.js";
import { loadQuotes, quoteNotFound } from "../quotes/quote-access.js";
import { loadOrderForActor } from "../work-orders/access.js";
import { loadBenchData } from "../work-orders/bench-queries.js";
import { buildApprovalPdf, buildDeliveryPdf, buildQuotePdf, buildSheetPdf } from "./forms.pdf.js";

export interface GeneratedPdf {
  pdf: Buffer;
  filename: string;
}

const ctxOf = (auth: AuthContext) => ({ tenantId: auth.tenantId, userId: auth.userId });

/** Estes documentos trazem dados de contato do cliente: papéis restritos (técnico) não os emitem. */
function assertFrontDesk(auth: AuthContext): void {
  if (isRestrictedToAssigned(auth.role)) throw new HttpError(403, "PERMISSAO_NEGADA", "Você não tem permissão para esta ação.");
}

async function userName(db: Db, userId: string): Promise<string> {
  const [row] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return row?.name ?? "—";
}

async function orderContext(db: Db, auth: AuthContext, orderId: string) {
  const order = await loadOrderForActor(db, auth, orderId);
  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, auth.tenantId)).limit(1);
  const [customer] = await db.select().from(schema.customers)
    .where(and(eq(schema.customers.tenantId, auth.tenantId), eq(schema.customers.id, order.customerId))).limit(1);
  const [device] = await db.select().from(schema.devices)
    .where(and(eq(schema.devices.tenantId, auth.tenantId), eq(schema.devices.id, order.deviceId))).limit(1);
  if (!tenant || !customer || !device) throw new Error("dados da OS incompletos");
  return { order, tenantName: tenant.tradeName ?? tenant.name, customer, deviceLabel: `${device.brand} ${device.model}` };
}

const audit = (db: Db, auth: AuthContext, meta: RequestMeta, action: string, targetType: string, targetId: string) =>
  recordAudit(db, { tenantId: auth.tenantId, actorUserId: auth.userId, action, targetType, targetId, outcome: "ok", correlationId: meta.correlationId, ip: meta.ip });

export async function generateSheet(deps: AppServices, auth: AuthContext, orderId: string, meta: RequestMeta): Promise<GeneratedPdf> {
  assertFrontDesk(auth);
  const data = await withContext(deps.pool, ctxOf(auth), async (db) => {
    const ctx = await orderContext(db, auth, orderId);
    const [inspection] = await db.select().from(schema.intakeInspections)
      .where(and(eq(schema.intakeInspections.tenantId, auth.tenantId), eq(schema.intakeInspections.workOrderId, ctx.order.id))).limit(1);
    if (!inspection) throw new Error("dados da OS incompletos");
    const diagnostics = await listDiagnostics(db, auth.tenantId, ctx.order.id);
    const quotes = (await loadQuotes(db, auth.tenantId, ctx.order.id)).filter((q) => q.state !== "rascunho");
    const bench = await loadBenchData(db, ctx.order, true);
    const events = await db.select({ type: schema.workOrderEvents.type, createdAt: schema.workOrderEvents.createdAt }).from(schema.workOrderEvents)
      .where(and(eq(schema.workOrderEvents.tenantId, auth.tenantId), eq(schema.workOrderEvents.workOrderId, ctx.order.id)))
      .orderBy(asc(schema.workOrderEvents.createdAt), asc(schema.workOrderEvents.id));
    await audit(db, auth, meta, "document_sheet_generated", "work_order", ctx.order.id);
    return {
      tenantName: ctx.tenantName,
      protocol: ctx.order.protocol,
      state: ctx.order.state,
      priority: ctx.order.priority,
      openedAt: ctx.order.createdAt,
      customerName: ctx.customer.name,
      customerPhone: ctx.customer.phone,
      deviceLabel: ctx.deviceLabel,
      reportedDefect: ctx.order.reportedDefect,
      physicalCondition: inspection.physicalCondition,
      accessories: inspection.accessories,
      checklist: inspection.checklist,
      diagnostic: diagnostics[0] ? { nature: diagnostics[0].nature, findings: diagnostics[0].findings, revision: diagnostics[0].revision } : null,
      quote: quotes[0] ? { number: quotes[0].number, state: quotes[0].state, totalCents: quotes[0].totalCents } : null,
      repairs: bench.repairs.map((r) => ({ procedure: r.procedure, outcome: r.outcome, partsUsed: r.partsUsed, createdAt: r.createdAt })),
      tests: bench.testRounds[0]?.results ?? [],
      events,
      issuedAt: deps.clock(),
    };
  });
  return { pdf: await buildSheetPdf(data), filename: `os-${data.protocol}.pdf` };
}

/** Lê o orçamento e a OS dele com o mesmo 404 para "inexistente", "outra empresa" e "não visível". */
async function quoteWithOrder(db: Db, auth: AuthContext, quoteId: string) {
  const [quote] = await db.select().from(schema.quoteVersions)
    .where(and(eq(schema.quoteVersions.tenantId, auth.tenantId), eq(schema.quoteVersions.id, quoteId))).limit(1);
  if (!quote) throw quoteNotFound();
  try {
    return { quote, ...(await orderContext(db, auth, quote.workOrderId)) };
  } catch {
    throw quoteNotFound();
  }
}

export async function generateQuoteDocument(deps: AppServices, auth: AuthContext, quoteId: string, meta: RequestMeta): Promise<GeneratedPdf> {
  assertFrontDesk(auth);
  const data = await withContext(deps.pool, ctxOf(auth), async (db) => {
    const ctx = await quoteWithOrder(db, auth, quoteId);
    // Rascunho não sai em PDF: só versões enviadas, a partir da linha já congelada.
    if (ctx.quote.state === "rascunho") throw new HttpError(422, "ORCAMENTO_EM_RASCUNHO", "Rascunhos não geram documento. Envie o orçamento primeiro.");
    const items = await db.select().from(schema.quoteItems)
      .where(and(eq(schema.quoteItems.tenantId, auth.tenantId), eq(schema.quoteItems.quoteVersionId, ctx.quote.id)))
      .orderBy(asc(schema.quoteItems.position));
    await audit(db, auth, meta, "document_quote_generated", "quote", ctx.quote.id);
    return {
      tenantName: ctx.tenantName,
      protocol: ctx.order.protocol,
      customerName: ctx.customer.name,
      deviceLabel: ctx.deviceLabel,
      quote: { ...ctx.quote, items },
      issuedAt: deps.clock(),
    };
  });
  return { pdf: await buildQuotePdf(data), filename: `orcamento-${data.protocol}-v${data.quote.number}.pdf` };
}

export async function generateApprovalRecord(deps: AppServices, auth: AuthContext, quoteId: string, meta: RequestMeta): Promise<GeneratedPdf> {
  assertFrontDesk(auth);
  const data = await withContext(deps.pool, ctxOf(auth), async (db) => {
    const ctx = await quoteWithOrder(db, auth, quoteId);
    const [decision] = await db.select().from(schema.quoteDecisions)
      .where(and(eq(schema.quoteDecisions.tenantId, auth.tenantId), eq(schema.quoteDecisions.quoteVersionId, ctx.quote.id))).limit(1);
    if (!decision) throw new HttpError(422, "SEM_DECISAO", "Este orçamento ainda não tem decisão registrada.");
    await audit(db, auth, meta, "document_approval_generated", "quote", ctx.quote.id);
    return {
      tenantName: ctx.tenantName,
      protocol: ctx.order.protocol,
      quoteNumber: ctx.quote.number,
      totalCents: ctx.quote.totalCents,
      decision: decision.decision,
      confirmedByName: decision.confirmedByName,
      registeredByName: await userName(db, decision.decidedBy),
      decidedAt: decision.decidedAt,
      note: decision.note,
      partUnavailable: decision.partUnavailable,
      issuedAt: deps.clock(),
    };
  });
  return { pdf: await buildApprovalPdf(data), filename: `decisao-${data.protocol}-v${data.quoteNumber}.pdf` };
}

export async function generateDeliveryReceipt(deps: AppServices, auth: AuthContext, orderId: string, meta: RequestMeta): Promise<GeneratedPdf> {
  assertFrontDesk(auth);
  const data = await withContext(deps.pool, ctxOf(auth), async (db) => {
    const ctx = await orderContext(db, auth, orderId);
    const [delivery] = await db.select().from(schema.deliveries)
      .where(and(eq(schema.deliveries.tenantId, auth.tenantId), eq(schema.deliveries.workOrderId, ctx.order.id))).limit(1);
    if (!delivery) throw new HttpError(422, "SEM_ENTREGA", "Esta OS ainda não foi entregue.");
    await audit(db, auth, meta, "document_delivery_generated", "work_order", ctx.order.id);
    return {
      tenantName: ctx.tenantName,
      protocol: ctx.order.protocol,
      customerName: ctx.customer.name,
      deviceLabel: ctx.deviceLabel,
      pickedUpByName: delivery.pickedUpByName,
      confirmationMethod: delivery.confirmationMethod,
      itemsReturned: delivery.itemsReturned,
      deliveredByName: await userName(db, delivery.deliveredBy),
      deliveredAt: delivery.deliveredAt,
      note: delivery.note,
      issuedAt: deps.clock(),
    };
  });
  return { pdf: await buildDeliveryPdf(data), filename: `entrega-${data.protocol}.pdf` };
}
