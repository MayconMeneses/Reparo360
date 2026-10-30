import { schema, withContext, type Db } from "@reparo360/database";
import { computeTotals, discountAllowed, QuoteError } from "@reparo360/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import type { AppServices } from "../../services.js";
import { addEvent, loadOrderForActor } from "../work-orders/access.js";
import { loadQuotes, lockOrderAndQuote, type QuoteRow } from "./quote-access.js";
import type { createQuoteBody, updateQuoteBody } from "./schemas.js";

type QuoteContent = z.infer<typeof createQuoteBody>;

const ctxOf = (auth: AuthContext) => ({ tenantId: auth.tenantId, userId: auth.userId });
const notInDiagnosis = () => new HttpError(422, "OS_FORA_DE_DIAGNOSTICO", "O orçamento só pode ser montado com a OS em diagnóstico.");

/** Substitui itens e totais do rascunho. A trava da OS e o estado de rascunho já foram conferidos. */
export async function writeDraftContent(db: Db, auth: AuthContext, quote: QuoteRow, input: QuoteContent): Promise<void> {
  let totals;
  try {
    totals = computeTotals(input.items, input.discountCents);
  } catch (error) {
    if (error instanceof QuoteError) throw new HttpError(422, error.code === "DESCONTO_INVALIDO" ? "DESCONTO_INVALIDO" : "ITEM_INVALIDO", error.message);
    throw error;
  }
  // Vale para quem SALVA o rascunho (técnico: 0%) e é conferido de novo, para quem ENVIA, no envio.
  if (!discountAllowed(auth.role, totals.subtotalCents, totals.discountCents)) {
    throw new HttpError(403, "DESCONTO_ACIMA_DO_LIMITE", "O desconto informado excede o limite do seu papel.");
  }
  await db.delete(schema.quoteItems).where(and(eq(schema.quoteItems.tenantId, auth.tenantId), eq(schema.quoteItems.quoteVersionId, quote.id)));
  if (input.items.length > 0) {
    await db.insert(schema.quoteItems).values(
      input.items.map((item, index) => ({ ...item, tenantId: auth.tenantId, quoteVersionId: quote.id, position: index + 1 })),
    );
  }
  await db
    .update(schema.quoteVersions)
    .set({
      ...totals,
      paymentTerms: input.paymentTerms ?? null,
      estimatedDays: input.estimatedDays ?? null,
      notes: input.notes ?? null,
      revision: quote.revision + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.quoteVersions.tenantId, auth.tenantId), eq(schema.quoteVersions.id, quote.id)));
}

export async function createDraft(deps: AppServices, auth: AuthContext, orderId: string, input: QuoteContent) {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const order = await loadOrderForActor(db, auth, orderId, true);
    if (order.state !== "EM_DIAGNOSTICO") throw notInDiagnosis();

    const [open] = await db
      .select({ id: schema.quoteVersions.id, state: schema.quoteVersions.state })
      .from(schema.quoteVersions)
      .where(and(
        eq(schema.quoteVersions.tenantId, auth.tenantId),
        eq(schema.quoteVersions.workOrderId, order.id),
        inArray(schema.quoteVersions.state, ["rascunho", "enviado"]),
      ))
      .limit(1);
    if (open) throw new HttpError(409, "ORCAMENTO_EM_ABERTO", "Esta OS já tem um orçamento em aberto.", { quoteId: open.id, state: open.state });

    const [last] = await db
      .select({ number: sql<number>`coalesce(max(${schema.quoteVersions.number}), 0)::int` })
      .from(schema.quoteVersions)
      .where(and(eq(schema.quoteVersions.tenantId, auth.tenantId), eq(schema.quoteVersions.workOrderId, order.id)));
    const [quote] = await db
      .insert(schema.quoteVersions)
      .values({ tenantId: auth.tenantId, workOrderId: order.id, number: (last?.number ?? 0) + 1, createdBy: auth.userId })
      .returning();
    if (!quote) throw new Error("insert de orçamento não retornou linha");
    await writeDraftContent(db, auth, quote, input);
    await addEvent(db, { tenantId: auth.tenantId, workOrderId: order.id, type: "orcamento_criado", actorUserId: auth.userId });
    const [created] = (await loadQuotes(db, auth.tenantId, order.id)).filter((q) => q.id === quote.id);
    return created;
  });
}

export async function updateDraft(deps: AppServices, auth: AuthContext, quoteId: string, input: z.infer<typeof updateQuoteBody>) {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const { order, quote } = await lockOrderAndQuote(db, auth, quoteId);
    if (quote.state !== "rascunho") throw new HttpError(409, "ORCAMENTO_NAO_EDITAVEL", "Somente rascunhos podem ser editados.", { state: quote.state });
    if (quote.revision !== input.revision) {
      throw new HttpError(409, "CONFLITO_DE_VERSAO", "O rascunho foi alterado por outra pessoa. Recarregue e tente novamente.", { currentRevision: quote.revision });
    }
    if (order.state !== "EM_DIAGNOSTICO") throw notInDiagnosis();
    await writeDraftContent(db, auth, quote, {
      items: input.items,
      discountCents: input.discountCents,
      paymentTerms: input.paymentTerms,
      estimatedDays: input.estimatedDays,
      notes: input.notes,
    });
    const [updated] = (await loadQuotes(db, auth.tenantId, order.id)).filter((q) => q.id === quote.id);
    return updated;
  });
}

export async function listOrderQuotes(deps: AppServices, auth: AuthContext, orderId: string) {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const order = await loadOrderForActor(db, auth, orderId);
    return loadQuotes(db, auth.tenantId, order.id);
  });
}
