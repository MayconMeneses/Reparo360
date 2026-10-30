import { schema, withContext, type Db } from "@reparo360/database";
import { addDays, DEFAULT_QUOTE_VALIDITY_DAYS, discountAllowed, type TransitionAction } from "@reparo360/domain";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import type { AppServices } from "../../services.js";
import type { RequestMeta } from "../identity/auth.service.js";
import { lockOrderById, type WorkOrderRow } from "../work-orders/access.js";
import { applyTransition } from "../work-orders/transitions.js";
import { loadQuotes, lockOrderAndQuote, type QuoteRow } from "./quote-access.js";

const ctxOf = (auth: AuthContext) => ({ tenantId: auth.tenantId, userId: auth.userId });

const auditOf = (auth: AuthContext, meta: RequestMeta, action: string, quoteId: string) => ({
  tenantId: auth.tenantId,
  actorUserId: auth.userId,
  action,
  targetType: "quote",
  targetId: quoteId,
  outcome: "ok" as const,
  correlationId: meta.correlationId,
  ip: meta.ip,
});

export interface SubmitInput {
  revision: number;
  validityDays?: number;
  authorizeSuspicion: boolean;
}

export async function submitQuote(deps: AppServices, auth: AuthContext, quoteId: string, input: SubmitInput, meta: RequestMeta) {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const { order, quote } = await lockOrderAndQuote(db, auth, quoteId);
    if (quote.state !== "rascunho") throw new HttpError(409, "ORCAMENTO_JA_ENVIADO", "Este orçamento já foi enviado.", { state: quote.state });
    if (quote.revision !== input.revision) {
      throw new HttpError(409, "CONFLITO_DE_VERSAO", "O rascunho foi alterado por outra pessoa. Recarregue e tente novamente.", { currentRevision: quote.revision });
    }

    const [{ total } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.quoteItems)
      .where(and(eq(schema.quoteItems.tenantId, auth.tenantId), eq(schema.quoteItems.quoteVersionId, quote.id)));
    if (total === 0) throw new HttpError(422, "ORCAMENTO_SEM_ITENS", "Inclua ao menos um item antes de enviar.");
    const missing = [quote.paymentTerms ? null : "paymentTerms", quote.estimatedDays ? null : "estimatedDays"].filter(Boolean);
    if (missing.length > 0) {
      throw new HttpError(422, "CAMPOS_OBRIGATORIOS_AUSENTES", "Informe condições de pagamento e previsão de execução.", { missing });
    }
    if (!discountAllowed(auth.role, quote.subtotalCents, quote.discountCents)) {
      throw new HttpError(403, "DESCONTO_ACIMA_DO_LIMITE", "O desconto do orçamento excede o limite do seu papel.");
    }

    const [diagnostic] = await db
      .select()
      .from(schema.diagnostics)
      .where(and(eq(schema.diagnostics.tenantId, auth.tenantId), eq(schema.diagnostics.workOrderId, order.id)))
      .orderBy(desc(schema.diagnostics.revision))
      .limit(1);
    if (!diagnostic) throw new HttpError(422, "SEM_DIAGNOSTICO", "Registre o diagnóstico antes de enviar o orçamento.");
    if (diagnostic.nature === "inconclusivo") {
      throw new HttpError(422, "DIAGNOSTICO_INCONCLUSIVO", "Diagnóstico inconclusivo não sustenta um orçamento.");
    }
    if (diagnostic.nature === "suspeita" && !input.authorizeSuspicion) {
      throw new HttpError(422, "DIAGNOSTICO_NAO_CONFIRMADO", "O diagnóstico é apenas uma suspeita. Confirme a autorização para orçar assim mesmo.");
    }

    // A transição valida estado e papel antes de qualquer alteração do orçamento.
    const applied = await applyTransition(db, { actor: auth, order, action: "enviar_orcamento" });
    await db
      .update(schema.quoteVersions)
      .set({
        state: "enviado",
        validUntil: addDays(deps.clock(), input.validityDays ?? DEFAULT_QUOTE_VALIDITY_DAYS),
        basedOnDiagnosticId: diagnostic.id,
        suspicionAuthorizedBy: diagnostic.nature === "suspeita" ? auth.userId : null,
        submittedBy: auth.userId,
        submittedAt: deps.clock(),
        revision: quote.revision + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.quoteVersions.tenantId, auth.tenantId), eq(schema.quoteVersions.id, quote.id)));
    await recordAudit(db, auditOf(auth, meta, "quote_submitted", quote.id));
    const [sent] = (await loadQuotes(db, auth.tenantId, order.id)).filter((q) => q.id === quote.id);
    return { quote: sent, order: applied };
  });
}

/** Revisar: a versão enviada vira "substituido" e nasce um novo rascunho com o mesmo conteúdo. */
export async function reviseQuote(deps: AppServices, auth: AuthContext, quoteId: string, meta: RequestMeta) {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const { order, quote } = await lockOrderAndQuote(db, auth, quoteId);
    if (quote.state !== "enviado") throw new HttpError(422, "ORCAMENTO_NAO_ENVIADO", "Só um orçamento enviado pode ser revisado.", { state: quote.state });

    const applied = await applyTransition(db, { actor: auth, order, action: "revisar_orcamento" });
    const items = await db
      .select()
      .from(schema.quoteItems)
      .where(and(eq(schema.quoteItems.tenantId, auth.tenantId), eq(schema.quoteItems.quoteVersionId, quote.id)))
      .orderBy(asc(schema.quoteItems.position));
    // O antigo sai de "aberto" antes de o novo nascer (índice parcial: uma versão aberta por OS).
    await db
      .update(schema.quoteVersions)
      .set({ state: "substituido", decidedAt: deps.clock(), updatedAt: new Date() })
      .where(and(eq(schema.quoteVersions.tenantId, auth.tenantId), eq(schema.quoteVersions.id, quote.id)));
    const [fresh] = await db
      .insert(schema.quoteVersions)
      .values({
        tenantId: auth.tenantId,
        workOrderId: order.id,
        number: quote.number + 1,
        subtotalCents: quote.subtotalCents,
        discountCents: quote.discountCents,
        totalCents: quote.totalCents,
        paymentTerms: quote.paymentTerms,
        estimatedDays: quote.estimatedDays,
        notes: quote.notes,
        createdBy: auth.userId,
      })
      .returning();
    if (!fresh) throw new Error("insert de orçamento não retornou linha");
    if (items.length > 0) {
      await db.insert(schema.quoteItems).values(
        items.map((i) => ({ tenantId: auth.tenantId, quoteVersionId: fresh.id, position: i.position, kind: i.kind, description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
      );
    }
    await recordAudit(db, auditOf(auth, meta, "quote_revised", quote.id));
    const [created] = (await loadQuotes(db, auth.tenantId, order.id)).filter((q) => q.id === fresh.id);
    return { quote: created, order: applied };
  });
}

/** Marca expirado e move a OS (ator do sistema: o evento fica sem autor). Sem checar papel. */
async function expireLocked(db: Db, deps: AppServices, order: WorkOrderRow, quote: QuoteRow): Promise<void> {
  await db
    .update(schema.quoteVersions)
    .set({ state: "expirado", decidedAt: deps.clock(), updatedAt: new Date() })
    .where(and(eq(schema.quoteVersions.tenantId, quote.tenantId), eq(schema.quoteVersions.id, quote.id)));
  await applyTransition(db, { actor: null, order, action: "expirar_orcamento" });
  await recordAudit(db, {
    tenantId: quote.tenantId,
    action: "quote_expired",
    targetType: "quote",
    targetId: quote.id,
    outcome: "ok",
  });
}

export type DecisionResult =
  | { kind: "expired" }
  | { kind: "replay" | "decided"; decision: string; orderState: string; orderVersion: number };

export interface DecisionInput {
  decision: "aprovado" | "recusado";
  confirmedByName: string;
  note?: string;
  partUnavailable: boolean;
}

/**
 * Decisão presencial sobre uma versão específica. Quando a validade já venceu, a expiração é
 * CONFIRMADA (commit) e o resultado `expired` volta ao chamador, que responde 422 fora da transação.
 * Lançar aqui dentro desfaria a própria expiração.
 */
export async function decideQuote(deps: AppServices, auth: AuthContext, quoteId: string, input: DecisionInput, meta: RequestMeta): Promise<DecisionResult> {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const { order, quote } = await lockOrderAndQuote(db, auth, quoteId);

    const [existing] = await db
      .select()
      .from(schema.quoteDecisions)
      .where(and(eq(schema.quoteDecisions.tenantId, auth.tenantId), eq(schema.quoteDecisions.quoteVersionId, quote.id)))
      .limit(1);
    if (existing) {
      if (existing.decision !== input.decision) {
        throw new HttpError(409, "DECISAO_CONFLITANTE", "Este orçamento já foi decidido de outra forma.", { decision: existing.decision });
      }
      return { kind: "replay", decision: existing.decision, orderState: order.state, orderVersion: order.version };
    }
    if (quote.state !== "enviado") {
      throw new HttpError(422, "ORCAMENTO_NAO_ENVIADO", "Só um orçamento enviado e vigente pode ser decidido.", { state: quote.state });
    }
    if (quote.validUntil && quote.validUntil.getTime() <= deps.clock().getTime()) {
      await expireLocked(db, deps, order, quote);
      return { kind: "expired" };
    }

    const action: TransitionAction =
      input.decision === "recusado" ? "recusar_orcamento" : input.partUnavailable ? "aprovar_orcamento_aguardando_peca" : "aprovar_orcamento";
    const applied = await applyTransition(db, { actor: auth, order, action, reason: input.note });
    await db.insert(schema.quoteDecisions).values({
      tenantId: auth.tenantId,
      quoteVersionId: quote.id,
      decision: input.decision,
      channel: "presencial",
      decidedBy: auth.userId,
      confirmedByName: input.confirmedByName,
      note: input.note,
      partUnavailable: input.partUnavailable,
    });
    await db
      .update(schema.quoteVersions)
      .set({ state: input.decision, decidedAt: deps.clock(), updatedAt: new Date() })
      .where(and(eq(schema.quoteVersions.tenantId, auth.tenantId), eq(schema.quoteVersions.id, quote.id)));
    await recordAudit(db, auditOf(auth, meta, `quote_${input.decision}_presencial`, quote.id));
    return { kind: "decided", decision: input.decision, orderState: applied.state, orderVersion: applied.version };
  });
}

/**
 * Varre a empresa e expira orçamentos vencidos. Agendamento automático ainda não existe
 * (NOT_RUN): hoje é acionado por este método/endpoint.
 */
export async function expireDueQuotes(deps: AppServices, auth: AuthContext): Promise<{ expired: number; failed: number }> {
  const due = await withContext(deps.pool, ctxOf(auth), (db) =>
    db
      .select({ id: schema.quoteVersions.id, workOrderId: schema.quoteVersions.workOrderId })
      .from(schema.quoteVersions)
      .where(and(
        eq(schema.quoteVersions.tenantId, auth.tenantId),
        eq(schema.quoteVersions.state, "enviado"),
        lte(schema.quoteVersions.validUntil, deps.clock()),
      ))
      .orderBy(asc(schema.quoteVersions.validUntil))
      .limit(100));

  let expired = 0;
  let failed = 0;
  for (const item of due) {
    try {
      await withContext(deps.pool, ctxOf(auth), async (db) => {
        const order = await lockOrderById(db, auth.tenantId, item.workOrderId);
        const [quote] = await db
          .select()
          .from(schema.quoteVersions)
          .where(and(eq(schema.quoteVersions.tenantId, auth.tenantId), eq(schema.quoteVersions.id, item.id)))
          .limit(1)
          .for("update");
        if (!order || !quote || quote.state !== "enviado" || !quote.validUntil || quote.validUntil.getTime() > deps.clock().getTime()) return;
        await expireLocked(db, deps, order, quote);
        expired += 1;
      });
    } catch {
      failed += 1;
    }
  }
  return { expired, failed };
}
