import { schema, type Db } from "@reparo360/database";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import { loadOrderForActor, type WorkOrderRow } from "../work-orders/access.js";

export type QuoteRow = typeof schema.quoteVersions.$inferSelect;

export const quoteNotFound = () => new HttpError(404, "ORCAMENTO_NAO_ENCONTRADO", "Orçamento não encontrado.");

/**
 * Ordem de travas fixa em todo o módulo: primeiro a linha da OS, depois a versão do orçamento.
 * Misturar a ordem entre operações concorrentes causaria deadlock.
 * "Outra empresa", "inexistente" e "OS não visível ao papel" respondem igual (404).
 */
export async function lockOrderAndQuote(db: Db, auth: AuthContext, quoteId: string): Promise<{ order: WorkOrderRow; quote: QuoteRow }> {
  const [peek] = await db
    .select({ workOrderId: schema.quoteVersions.workOrderId })
    .from(schema.quoteVersions)
    .where(and(eq(schema.quoteVersions.tenantId, auth.tenantId), eq(schema.quoteVersions.id, quoteId)))
    .limit(1);
  if (!peek) throw quoteNotFound();
  let order: WorkOrderRow;
  try {
    order = await loadOrderForActor(db, auth, peek.workOrderId, true);
  } catch {
    throw quoteNotFound();
  }
  const [quote] = await db
    .select()
    .from(schema.quoteVersions)
    .where(and(eq(schema.quoteVersions.tenantId, auth.tenantId), eq(schema.quoteVersions.id, quoteId)))
    .limit(1)
    .for("update");
  if (!quote) throw quoteNotFound();
  return { order, quote };
}

export type QuoteDto = ReturnType<typeof quoteDto>;

export function quoteDto(
  quote: QuoteRow,
  items: Array<typeof schema.quoteItems.$inferSelect>,
  decision: typeof schema.quoteDecisions.$inferSelect | undefined,
) {
  return {
    id: quote.id,
    number: quote.number,
    state: quote.state,
    revision: quote.revision,
    subtotalCents: quote.subtotalCents,
    discountCents: quote.discountCents,
    totalCents: quote.totalCents,
    paymentTerms: quote.paymentTerms,
    estimatedDays: quote.estimatedDays,
    notes: quote.notes,
    validUntil: quote.validUntil,
    basedOnDiagnosticId: quote.basedOnDiagnosticId,
    suspicionAuthorizedBy: quote.suspicionAuthorizedBy,
    submittedAt: quote.submittedAt,
    decidedAt: quote.decidedAt,
    createdAt: quote.createdAt,
    items: items.map((i) => ({ position: i.position, kind: i.kind, description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
    decision: decision
      ? {
          decision: decision.decision,
          channel: decision.channel,
          confirmedByName: decision.confirmedByName,
          note: decision.note,
          partUnavailable: decision.partUnavailable,
          decidedBy: decision.decidedBy,
          decidedAt: decision.decidedAt,
        }
      : null,
  };
}

/** Todas as versões da OS (mais recente primeiro), com itens e decisão. */
export async function loadQuotes(db: Db, tenantId: string, orderId: string): Promise<QuoteDto[]> {
  const versions = await db
    .select()
    .from(schema.quoteVersions)
    .where(and(eq(schema.quoteVersions.tenantId, tenantId), eq(schema.quoteVersions.workOrderId, orderId)))
    .orderBy(asc(schema.quoteVersions.number));
  if (versions.length === 0) return [];
  const ids = versions.map((v) => v.id);
  const items = await db
    .select()
    .from(schema.quoteItems)
    .where(and(eq(schema.quoteItems.tenantId, tenantId), inArray(schema.quoteItems.quoteVersionId, ids)))
    .orderBy(asc(schema.quoteItems.position));
  const decisions = await db
    .select()
    .from(schema.quoteDecisions)
    .where(and(eq(schema.quoteDecisions.tenantId, tenantId), inArray(schema.quoteDecisions.quoteVersionId, ids)));
  return versions
    .map((v) =>
      quoteDto(
        v,
        items.filter((i) => i.quoteVersionId === v.id),
        decisions.find((d) => d.quoteVersionId === v.id),
      ))
    .reverse();
}
