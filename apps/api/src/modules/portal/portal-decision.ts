import { createHmac, randomInt, randomUUID } from "node:crypto";
import { schema, withContext, type Db } from "@reparo360/database";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit } from "../../audit.js";
import { HttpError } from "../../http-error.js";
import { safeEqual } from "../../security/tokens.js";
import type { AppServices } from "../../services.js";
import { expireLocked } from "../quotes/quotes.workflow.js";
import { lockOrderById, type WorkOrderRow } from "../work-orders/access.js";
import { applyTransition } from "../work-orders/transitions.js";
import { invalidLink, isGrantLive, resolveGrant, type GrantRow } from "./portal-grant.js";

export const decisionBody = z.strictObject({ decision: z.enum(["aprovado", "recusado"]), code: z.string().regex(/^\d{6}$/) });
export const requestBody = z.strictObject({});

const codeHash = (deps: AppServices, id: string, code: string) =>
  createHmac("sha256", deps.config.verificationSecret ?? "").update(`${id}:${code}`).digest("hex");

export const maskEmail = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
};

type QuoteRow = typeof schema.quoteVersions.$inferSelect;

/** A aprovação remota só existe com envio de e-mail ligado, e-mail cadastrado e orçamento enviado e vigente. */
export function remoteOffer(
  deps: AppServices,
  order: Pick<WorkOrderRow, "state">,
  quote: Pick<QuoteRow, "state" | "validUntil"> | undefined,
  email: string | null | undefined,
) {
  const available =
    deps.mailer.enabled && Boolean(email) && order.state === "AGUARDANDO_APROVACAO" && quote?.state === "enviado" &&
    Boolean(quote.validUntil && quote.validUntil.getTime() > deps.clock().getTime());
  return { available, emailHint: available && email ? maskEmail(email) : undefined };
}

async function currentQuote(db: Db, grant: GrantRow, orderId: string): Promise<QuoteRow | undefined> {
  const [quote] = await db
    .select()
    .from(schema.quoteVersions)
    .where(and(eq(schema.quoteVersions.tenantId, grant.tenantId), eq(schema.quoteVersions.workOrderId, orderId), eq(schema.quoteVersions.state, "enviado")))
    .limit(1);
  return quote;
}

async function customerOf(db: Db, tenantId: string, customerId: string) {
  const [row] = await db
    .select({ name: schema.customers.name, email: schema.customers.email })
    .from(schema.customers)
    .where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.id, customerId)))
    .limit(1);
  return row;
}

type Issued =
  | { kind: "invalid" | "unavailable" | "limit" | "wait" }
  | { kind: "issued"; code: string; to: string; protocol: string; emailHint: string };

/** Pede um código de uso único, enviado SÓ ao e-mail já cadastrado do cliente (nunca a um endereço informado na tela). */
export async function requestCode(deps: AppServices, token: string | undefined) {
  const grant = await resolveGrant(deps, token);
  const { config } = deps;
  const now = deps.clock();
  const outcome = await withContext<Issued>(deps.pool, { tenantId: grant.tenantId }, async (db) => {
    const order = await lockOrderById(db, grant.tenantId, grant.workOrderId);
    if (!order || !(await isGrantLive(db, deps, grant))) return { kind: "invalid" };
    const quote = await currentQuote(db, grant, order.id);
    const customer = await customerOf(db, grant.tenantId, order.customerId);
    if (!quote || !customer?.email || !remoteOffer(deps, order, quote, customer.email).available) return { kind: "unavailable" };

    const recent = await db
      .select({ createdAt: schema.customerVerifications.createdAt })
      .from(schema.customerVerifications)
      .where(and(
        eq(schema.customerVerifications.tenantId, grant.tenantId),
        eq(schema.customerVerifications.grantId, grant.id),
        gt(schema.customerVerifications.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ))
      .orderBy(desc(schema.customerVerifications.createdAt));
    if (recent.length >= config.verificationMaxPerHour) return { kind: "limit" };
    const last = recent[0];
    if (last && now.getTime() - last.createdAt.getTime() < config.verificationMinIntervalMs) return { kind: "wait" };

    // Só o código mais novo vale: os anteriores deste link deixam de servir.
    await db
      .update(schema.customerVerifications)
      .set({ consumedAt: now })
      .where(and(eq(schema.customerVerifications.tenantId, grant.tenantId), eq(schema.customerVerifications.grantId, grant.id), isNull(schema.customerVerifications.consumedAt)));
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const id = randomUUID();
    await db.insert(schema.customerVerifications).values({
      id, tenantId: grant.tenantId, grantId: grant.id, quoteVersionId: quote.id, codeHash: codeHash(deps, id, code),
      expiresAt: new Date(now.getTime() + config.verificationTtlMs), createdAt: now,
    });
    await recordAudit(db, { tenantId: grant.tenantId, action: "customer_code_requested", targetType: "work_order", targetId: order.id, outcome: "ok" });
    return { kind: "issued", code, to: customer.email, protocol: order.protocol, emailHint: maskEmail(customer.email) };
  });

  if (outcome.kind !== "issued") {
    if (outcome.kind === "invalid") throw invalidLink();
    if (outcome.kind === "unavailable") throw new HttpError(422, "REMOTO_INDISPONIVEL", "A aprovação à distância não está disponível. Fale com a assistência.");
    throw new HttpError(429, "MUITAS_TENTATIVAS", outcome.kind === "limit" ? "Muitos códigos pedidos. Tente novamente mais tarde." : "Aguarde um minuto para pedir outro código.");
  }
  const minutes = Math.round(config.verificationTtlMs / 60000);
  try {
    await deps.mailer.send({
      to: outcome.to,
      subject: `Código de confirmação do orçamento ${outcome.protocol}`,
      text: `Seu código para confirmar a decisão sobre o orçamento da OS ${outcome.protocol} é ${outcome.code}.\nEle vale por ${minutes} minutos. Se não foi você, ignore esta mensagem.`,
    });
  } catch {
    // Nada do e-mail nem do código vai ao log; quem pediu pode tentar de novo depois do intervalo.
    throw new HttpError(503, "ENVIO_INDISPONIVEL", "Não foi possível enviar o código agora. Tente novamente em instantes.");
  }
  return { sent: true, emailHint: outcome.emailHint, expiresInMinutes: minutes };
}

type Decided =
  | { kind: "invalid" | "locked" | "stale" | "expired" }
  | { kind: "code"; attemptsLeft?: number }
  | { kind: "decided"; decision: string; state: string };

export async function decideByCode(deps: AppServices, token: string | undefined, input: z.infer<typeof decisionBody>) {
  const grant = await resolveGrant(deps, token);
  const { config } = deps;
  const now = deps.clock();
  // Resultados (não exceções) para o contador de tentativas confirmar mesmo quando o código está errado.
  const outcome = await withContext<Decided>(deps.pool, { tenantId: grant.tenantId }, async (db) => {
    const order = await lockOrderById(db, grant.tenantId, grant.workOrderId);
    if (!order || !(await isGrantLive(db, deps, grant))) return { kind: "invalid" };
    const [challenge] = await db
      .select()
      .from(schema.customerVerifications)
      .where(and(eq(schema.customerVerifications.tenantId, grant.tenantId), eq(schema.customerVerifications.grantId, grant.id), isNull(schema.customerVerifications.consumedAt)))
      .orderBy(desc(schema.customerVerifications.createdAt))
      .limit(1)
      .for("update");
    if (!challenge || challenge.expiresAt.getTime() <= now.getTime()) return { kind: "code" };
    if (challenge.attempts >= config.verificationMaxAttempts) return { kind: "locked" };
    if (!safeEqual(codeHash(deps, challenge.id, input.code), challenge.codeHash)) {
      await db.update(schema.customerVerifications).set({ attempts: sql`${schema.customerVerifications.attempts} + 1` })
        .where(and(eq(schema.customerVerifications.tenantId, grant.tenantId), eq(schema.customerVerifications.id, challenge.id)));
      return { kind: "code", attemptsLeft: Math.max(0, config.verificationMaxAttempts - challenge.attempts - 1) };
    }

    const [quote] = await db
      .select()
      .from(schema.quoteVersions)
      .where(and(eq(schema.quoteVersions.tenantId, grant.tenantId), eq(schema.quoteVersions.id, challenge.quoteVersionId)))
      .limit(1)
      .for("update");
    if (!quote || quote.state !== "enviado" || order.state !== "AGUARDANDO_APROVACAO") return { kind: "stale" };
    if (quote.validUntil && quote.validUntil.getTime() <= now.getTime()) {
      await expireLocked(db, deps, order, quote);
      return { kind: "expired" };
    }
    const customer = await customerOf(db, grant.tenantId, order.customerId);
    if (!customer) return { kind: "invalid" };

    const consumed = await db
      .update(schema.customerVerifications)
      .set({ consumedAt: now })
      .where(and(eq(schema.customerVerifications.tenantId, grant.tenantId), eq(schema.customerVerifications.id, challenge.id), isNull(schema.customerVerifications.consumedAt)))
      .returning({ id: schema.customerVerifications.id });
    if (consumed.length === 0) return { kind: "code" };

    // Só aprovar/recusar: a aprovação "aguardando peça" é decisão da equipe e não passa por aqui.
    const action = input.decision === "recusado" ? "recusar_orcamento" : "aprovar_orcamento";
    const applied = await applyTransition(db, { actor: null, order, action, origin: "cliente" });
    await db.insert(schema.quoteDecisions).values({
      tenantId: grant.tenantId, quoteVersionId: quote.id, decision: input.decision, channel: "remoto",
      verificationId: challenge.id, confirmedByName: customer.name,
    });
    await db.update(schema.quoteVersions).set({ state: input.decision, decidedAt: now, updatedAt: new Date() })
      .where(and(eq(schema.quoteVersions.tenantId, grant.tenantId), eq(schema.quoteVersions.id, quote.id)));
    await recordAudit(db, { tenantId: grant.tenantId, action: `quote_${input.decision}_remoto`, targetType: "quote", targetId: quote.id, outcome: "ok" });
    return { kind: "decided", decision: input.decision, state: applied.state };
  });

  switch (outcome.kind) {
    case "invalid": throw invalidLink();
    case "locked": throw new HttpError(429, "TENTATIVAS_ESGOTADAS", "Muitas tentativas erradas. Peça um novo código.");
    case "stale": throw new HttpError(409, "ORCAMENTO_MUDOU", "Este orçamento mudou ou já foi decidido. Recarregue a página.");
    case "expired": throw new HttpError(422, "ORCAMENTO_EXPIRADO", "A validade deste orçamento terminou. Fale com a assistência.");
    case "code": throw new HttpError(422, "CODIGO_INVALIDO", "Código inválido ou expirado.", outcome.attemptsLeft === undefined ? undefined : { attemptsLeft: outcome.attemptsLeft });
    default: return { decision: outcome.decision, state: outcome.state };
  }
}
