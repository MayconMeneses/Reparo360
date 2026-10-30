import { schema, withContext } from "@reparo360/database";
import { ruleFor, type TransitionAction } from "@reparo360/domain";
import { and, asc, eq, isNull } from "drizzle-orm";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import type { AppServices } from "../../services.js";
import type { RequestMeta } from "../identity/auth.service.js";
import { addEvent, loadOrderForActor, lockOrderById, orderNotFound } from "./access.js";
import { applyTransition } from "./transitions.js";
import { assertAssignableTechnician } from "./work-orders.service.js";

const ctxOf = (auth: AuthContext) => ({ tenantId: auth.tenantId, userId: auth.userId });

export async function transitionOrder(
  deps: AppServices,
  auth: AuthContext,
  orderId: string,
  input: { action: TransitionAction; expectedVersion: number; reason?: string },
  meta: RequestMeta,
) {
  const rule = ruleFor(input.action);
  if (rule?.mode !== "direct") {
    throw new HttpError(422, "ACAO_INDISPONIVEL", "Esta ação não está disponível neste endpoint.");
  }
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const order = await loadOrderForActor(db, auth, orderId, true);
    if (order.version !== input.expectedVersion) {
      throw new HttpError(409, "CONFLITO_DE_VERSAO", "A OS foi alterada por outra pessoa. Recarregue e tente novamente.", {
        currentVersion: order.version,
      });
    }
    if (input.action === "iniciar_diagnostico" && !order.technicianId) {
      throw new HttpError(422, "SEM_TECNICO_ATRIBUIDO", "Atribua um técnico antes de iniciar o diagnóstico.");
    }
    const result = await applyTransition(db, { actor: auth, order, action: input.action, reason: input.reason });
    await recordAudit(db, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: `work_order_${input.action}`,
      targetType: "work_order",
      targetId: order.id,
      outcome: "ok",
      correlationId: meta.correlationId,
      ip: meta.ip,
    });
    return result;
  });
}

/** Fila de OS recebidas e sem técnico (P-12). Sem nome do cliente e sem o texto livre do defeito. */
export async function listQueue(deps: AppServices, auth: AuthContext) {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const rows = await db
      .select({
        id: schema.workOrders.id,
        protocol: schema.workOrders.protocol,
        priority: schema.workOrders.priority,
        createdAt: schema.workOrders.createdAt,
        category: schema.devices.category,
        brand: schema.devices.brand,
        model: schema.devices.model,
      })
      .from(schema.workOrders)
      .innerJoin(schema.devices, and(eq(schema.devices.tenantId, schema.workOrders.tenantId), eq(schema.devices.id, schema.workOrders.deviceId)))
      .where(and(eq(schema.workOrders.tenantId, auth.tenantId), eq(schema.workOrders.state, "RECEBIDA"), isNull(schema.workOrders.technicianId)))
      .orderBy(asc(schema.workOrders.createdAt), asc(schema.workOrders.id))
      .limit(50);
    return rows.map((row) => ({
      id: row.id,
      protocol: row.protocol,
      priority: row.priority,
      createdAt: row.createdAt,
      device: { category: row.category, brand: row.brand, model: row.model },
    }));
  });
}

/** O técnico assume uma OS da fila. Atualização condicional: de dois cliques simultâneos, só um vence. */
export async function claimOrder(deps: AppServices, auth: AuthContext, orderId: string, expectedVersion: number, meta: RequestMeta) {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const order = await lockOrderById(db, auth.tenantId, orderId);
    if (!order) throw orderNotFound();
    if (order.state !== "RECEBIDA" || order.technicianId) {
      throw new HttpError(409, "OS_JA_ATRIBUIDA", "Esta OS já foi assumida ou não está mais na fila.");
    }
    await assertAssignableTechnician(db, auth.tenantId, auth.userId);
    const [updated] = await db
      .update(schema.workOrders)
      .set({ technicianId: auth.userId, version: order.version + 1, updatedAt: new Date() })
      .where(and(
        eq(schema.workOrders.tenantId, auth.tenantId),
        eq(schema.workOrders.id, order.id),
        isNull(schema.workOrders.technicianId),
        eq(schema.workOrders.version, expectedVersion),
      ))
      .returning({ version: schema.workOrders.version });
    if (!updated) throw new HttpError(409, "CONFLITO_DE_VERSAO", "A OS foi alterada por outra pessoa. Recarregue e tente novamente.");
    await addEvent(db, { tenantId: auth.tenantId, workOrderId: order.id, type: "os_assumida", actorUserId: auth.userId });
    await recordAudit(db, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "work_order_claimed",
      targetType: "work_order",
      targetId: order.id,
      outcome: "ok",
      correlationId: meta.correlationId,
      ip: meta.ip,
    });
    return { version: updated.version };
  });
}
