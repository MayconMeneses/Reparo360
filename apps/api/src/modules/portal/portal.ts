import { schema, withContext } from "@reparo360/database";
import { addDays, isClosedForChanges, type WorkOrderState } from "@reparo360/domain";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import { metaOf, requireContext } from "../../request-helpers.js";
import { hashToken, newToken } from "../../security/tokens.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import type { RequestMeta } from "../identity/auth.service.js";
import { loadOrderForActor } from "../work-orders/access.js";
import { workOrderParams } from "../work-orders/schemas.js";
import { decideByCode, decisionBody, remoteOffer, requestBody, requestCode } from "./portal-decision.js";
import { invalidLink, resolveGrant } from "./portal-grant.js";

const PORTAL_STATE_LABEL: Record<string, string> = {
  RECEBIDA: "Recebido pela assistência",
  EM_DIAGNOSTICO: "Em diagnóstico",
  AGUARDANDO_APROVACAO: "Aguardando a decisão sobre o orçamento",
  AGUARDANDO_PECA: "Aguardando peça",
  EM_REPARO: "Em reparo",
  EM_TESTE: "Em testes",
  PRONTA_RETIRADA: "Pronto para retirada",
  PRONTA_RETIRADA_SEM_REPARO: "Pronto para retirada (sem reparo)",
  ENTREGUE: "Entregue",
};

// Lista POSITIVA: só estes eventos aparecem, com texto próprio para o consumidor. Motivos livres,
// autores, observações e qualquer outro evento nunca saem daqui.
const PORTAL_EVENT_LABEL: Record<string, string> = {
  os_aberta: "Equipamento recebido",
  diagnostico_iniciado: "Diagnóstico iniciado",
  orcamento_enviado: "Orçamento disponível",
  orcamento_aprovado: "Orçamento aprovado",
  orcamento_recusado: "Orçamento recusado",
  orcamento_expirado: "Orçamento expirado",
  peca_recebida: "Peça recebida",
  testes_iniciados: "Em testes",
  testes_aprovados: "Pronto para retirada",
  liberada_sem_reparo: "Pronto para retirada (sem reparo)",
  entregue: "Equipamento entregue",
};

export async function createPortalLink(deps: AppServices, auth: AuthContext, orderId: string, meta: RequestMeta) {
  return withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
    const order = await loadOrderForActor(db, auth, orderId, true);
    if (order.state === "ENCERRADA" || order.state === "CANCELADA") throw new HttpError(422, "OS_ENCERRADA", "Esta OS está encerrada.");
    // Gerar outro link revoga o anterior (no máximo um ativo por OS).
    await db
      .update(schema.customerAccessGrants)
      .set({ revokedAt: deps.clock() })
      .where(and(eq(schema.customerAccessGrants.tenantId, auth.tenantId), eq(schema.customerAccessGrants.workOrderId, order.id), isNull(schema.customerAccessGrants.revokedAt)));
    const token = newToken();
    const expiresAt = addDays(deps.clock(), deps.config.portalLinkTtlDays);
    await db.insert(schema.customerAccessGrants).values({
      tenantId: auth.tenantId, workOrderId: order.id, tokenHash: hashToken(token), createdBy: auth.userId, expiresAt,
    });
    await recordAudit(db, {
      tenantId: auth.tenantId, actorUserId: auth.userId, action: "portal_link_created", targetType: "work_order", targetId: order.id,
      outcome: "ok", correlationId: meta.correlationId, ip: meta.ip,
    });
    // O token só existe aqui; no banco fica o hash. O trecho após # nunca vai ao servidor nem aos logs.
    return { token, expiresAt, path: `/portal#t=${token}` };
  });
}

export async function revokePortalLink(deps: AppServices, auth: AuthContext, orderId: string, meta: RequestMeta): Promise<void> {
  await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
    const order = await loadOrderForActor(db, auth, orderId, true);
    const revoked = await db
      .update(schema.customerAccessGrants)
      .set({ revokedAt: deps.clock() })
      .where(and(eq(schema.customerAccessGrants.tenantId, auth.tenantId), eq(schema.customerAccessGrants.workOrderId, order.id), isNull(schema.customerAccessGrants.revokedAt)))
      .returning({ id: schema.customerAccessGrants.id });
    if (revoked.length === 0) throw new HttpError(404, "LINK_NAO_ENCONTRADO", "Não há link ativo para esta OS.");
    await recordAudit(db, {
      tenantId: auth.tenantId, actorUserId: auth.userId, action: "portal_link_revoked", targetType: "work_order", targetId: order.id,
      outcome: "ok", correlationId: meta.correlationId, ip: meta.ip,
    });
  });
}

/** Visão do consumidor: somente leitura, lista branca de campos. Sem aprovar/recusar (P-03). */
export async function readPortal(deps: AppServices, token: string | undefined) {
  const grant = await resolveGrant(deps, token);

  const view = await withContext(deps.pool, { tenantId: grant.tenantId }, async (db) => {
    const [order] = await db
      .select()
      .from(schema.workOrders)
      .where(and(eq(schema.workOrders.tenantId, grant.tenantId), eq(schema.workOrders.id, grant.workOrderId)))
      .limit(1);
    if (!order || order.state === "ENCERRADA" || order.state === "CANCELADA") return null;
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, grant.tenantId)).limit(1);
    const [device] = await db
      .select({ category: schema.devices.category, brand: schema.devices.brand, model: schema.devices.model })
      .from(schema.devices)
      .where(and(eq(schema.devices.tenantId, grant.tenantId), eq(schema.devices.id, order.deviceId)))
      .limit(1);
    const events = await db
      .select({ type: schema.workOrderEvents.type, at: schema.workOrderEvents.createdAt })
      .from(schema.workOrderEvents)
      .where(and(eq(schema.workOrderEvents.tenantId, grant.tenantId), eq(schema.workOrderEvents.workOrderId, order.id), inArray(schema.workOrderEvents.type, Object.keys(PORTAL_EVENT_LABEL))))
      .orderBy(asc(schema.workOrderEvents.createdAt), asc(schema.workOrderEvents.id));
    // Só versões enviadas ou decididas; a vigente primeiro. Substituída e expirada vêm rotuladas.
    const [quote] = await db
      .select()
      .from(schema.quoteVersions)
      .where(and(eq(schema.quoteVersions.tenantId, grant.tenantId), eq(schema.quoteVersions.workOrderId, order.id), ne(schema.quoteVersions.state, "rascunho")))
      .orderBy(desc(schema.quoteVersions.number))
      .limit(1);
    const items = quote
      ? await db
          .select({ kind: schema.quoteItems.kind, description: schema.quoteItems.description, quantity: schema.quoteItems.quantity, unitPriceCents: schema.quoteItems.unitPriceCents })
          .from(schema.quoteItems)
          .where(and(eq(schema.quoteItems.tenantId, grant.tenantId), eq(schema.quoteItems.quoteVersionId, quote.id)))
          .orderBy(asc(schema.quoteItems.position))
      : [];
    const [customer] = await db
      .select({ email: schema.customers.email })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, grant.tenantId), eq(schema.customers.id, order.customerId)))
      .limit(1);
    return { order, tenant, device, events, quote, items, customerEmail: customer?.email ?? null };
  });
  if (!view?.tenant) throw invalidLink();

  const state = view.order.state as WorkOrderState;
  const offer = remoteOffer(deps, view.order, view.quote ?? undefined, view.customerEmail);
  return {
    protocol: view.order.protocol,
    state: { code: state, label: PORTAL_STATE_LABEL[state] ?? "Em andamento" },
    device: view.device,
    assistance: { name: view.tenant.tradeName ?? view.tenant.name, phone: view.tenant.phone },
    timeline: view.events.map((e) => ({ label: PORTAL_EVENT_LABEL[e.type] ?? "", at: e.at })),
    quote: view.quote
      ? {
          number: view.quote.number,
          state: view.quote.state,
          subtotalCents: view.quote.subtotalCents,
          discountCents: view.quote.discountCents,
          totalCents: view.quote.totalCents,
          validUntil: view.quote.validUntil,
          paymentTerms: view.quote.paymentTerms,
          estimatedDays: view.quote.estimatedDays,
          items: view.items,
        }
      : null,
    // Aprovar/recusar à distância exige código enviado ao e-mail cadastrado (P-03). Sem isso, só orientação.
    canDecide: offer.available,
    emailHint: offer.emailHint,
    decisionMessage: offer.available
      ? "Para aprovar ou recusar, peça o código que enviaremos ao seu e-mail cadastrado."
      : "Para aprovar ou recusar o orçamento, fale com a assistência.",
    readyForPickup: state === "PRONTA_RETIRADA" || state === "PRONTA_RETIRADA_SEM_REPARO",
    closed: isClosedForChanges(state),
  };
}

export function portalRoutes(deps: AppServices) {
  const staff = requireAuth(deps, { permission: "customer_access.manage" });

  return async function register(app: FastifyInstance): Promise<void> {
    app.post("/work-orders/:workOrderId/portal-link", { preHandler: staff }, async (request, reply) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      return reply.code(201).send(await createPortalLink(deps, requireContext(request), workOrderId, metaOf(request)));
    });

    app.delete("/work-orders/:workOrderId/portal-link", { preHandler: staff }, async (request, reply) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      await revokePortalLink(deps, requireContext(request), workOrderId, metaOf(request));
      return reply.code(204).send();
    });

    const tokenOf = (header: unknown) => (typeof header === "string" ? header : undefined);
    const noStore = { "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow, noarchive" };

    // Público e sem cookie: o token vem num CABEÇALHO (nunca na URL), lido do fragmento pelo navegador.
    app.post(
      "/portal/verification",
      { config: { rateLimit: { max: deps.config.portalRateLimitMax, timeWindow: "1 minute" } } },
      async (request, reply) => {
        requestBody.parse(request.body ?? {});
        return reply.code(202).headers(noStore).send(await requestCode(deps, tokenOf(request.headers["x-portal-token"])));
      },
    );

    app.post(
      "/portal/decision",
      { config: { rateLimit: { max: deps.config.portalRateLimitMax, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const body = decisionBody.parse(request.body);
        return reply.headers(noStore).send(await decideByCode(deps, tokenOf(request.headers["x-portal-token"]), body));
      },
    );

    app.get(
      "/portal/order",
      { config: { rateLimit: { max: deps.config.portalRateLimitMax, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const header = request.headers["x-portal-token"];
        const view = await readPortal(deps, typeof header === "string" ? header : undefined);
        return reply
          .header("referrer-policy", "no-referrer")
          .header("x-robots-tag", "noindex, nofollow, noarchive")
          .send(view);
      },
    );
  };
}
