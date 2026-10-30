import { schema, withContext, type Db } from "@reparo360/database";
import { formatProtocol, isClosedForChanges, protocolYear, type WorkOrderState } from "@reparo360/domain";
import { and, eq, sql } from "drizzle-orm";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError, isUniqueViolation } from "../../http-error.js";
import type { AppServices } from "../../services.js";
import type { RequestMeta } from "../identity/auth.service.js";
import { addEvent, loadOrderForActor, orderNotFound } from "./access.js";
import type { OpenWorkOrderInput } from "./schemas.js";

const IDEMPOTENCY_CONSTRAINT = "work_orders_tenant_idempotency_key";
const ctxOf = (auth: AuthContext) => ({ tenantId: auth.tenantId, userId: auth.userId });

export interface OpenedOrder {
  id: string;
  protocol: string;
  version: number;
  replay: boolean;
}

/** Só membro ativo com papel de técnico pode ser atribuído. */
export async function assertAssignableTechnician(db: Db, tenantId: string, userId: string): Promise<void> {
  const [member] = await db
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(and(
      eq(schema.memberships.tenantId, tenantId),
      eq(schema.memberships.userId, userId),
      eq(schema.memberships.role, "tecnico"),
      eq(schema.memberships.status, "ativo"),
    ))
    .limit(1);
  if (!member) throw new HttpError(422, "TECNICO_INVALIDO", "O técnico informado não existe ou está inativo.");
}

/**
 * Próximo protocolo da empresa no ano. O upsert trava a linha do contador até o fim da
 * transação: abre em série por empresa e, se a abertura falhar, o número volta (sem lacuna).
 */
async function nextProtocol(db: Db, tenantId: string, now: Date): Promise<string> {
  const year = protocolYear(now);
  const [row] = await db
    .insert(schema.protocolCounters)
    .values({ tenantId, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [schema.protocolCounters.tenantId, schema.protocolCounters.year],
      set: { lastNumber: sql`${schema.protocolCounters.lastNumber} + 1` },
    })
    .returning({ lastNumber: schema.protocolCounters.lastNumber });
  if (!row) throw new Error("contador de protocolo não retornou linha");
  return formatProtocol(year, row.lastNumber);
}

async function findByIdempotencyKey(db: Db, tenantId: string, key: string) {
  const [row] = await db
    .select()
    .from(schema.workOrders)
    .where(and(eq(schema.workOrders.tenantId, tenantId), eq(schema.workOrders.idempotencyKey, key)))
    .limit(1);
  return row;
}

function replayOf(existing: typeof schema.workOrders.$inferSelect, input: OpenWorkOrderInput): OpenedOrder {
  const same =
    existing.customerId === input.customerId &&
    existing.deviceId === input.deviceId &&
    existing.reportedDefect === input.reportedDefect;
  if (!same) {
    throw new HttpError(422, "CHAVE_DE_IDEMPOTENCIA_REUTILIZADA", "Esta chave já foi usada em outra requisição.");
  }
  return { id: existing.id, protocol: existing.protocol, version: existing.version, replay: true };
}

export async function openWorkOrder(
  deps: AppServices,
  auth: AuthContext,
  input: OpenWorkOrderInput,
  idempotencyKey: string | undefined,
  meta: RequestMeta,
): Promise<OpenedOrder> {
  try {
    return await withContext(deps.pool, ctxOf(auth), async (db) => {
      if (idempotencyKey) {
        const existing = await findByIdempotencyKey(db, auth.tenantId, idempotencyKey);
        if (existing) return replayOf(existing, input);
      }

      const [customer] = await db
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, auth.tenantId), eq(schema.customers.id, input.customerId)))
        .limit(1);
      if (!customer) throw new HttpError(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");

      const [device] = await db
        .select({ customerId: schema.devices.customerId })
        .from(schema.devices)
        .where(and(eq(schema.devices.tenantId, auth.tenantId), eq(schema.devices.id, input.deviceId)))
        .limit(1);
      if (!device) throw new HttpError(404, "EQUIPAMENTO_NAO_ENCONTRADO", "Equipamento não encontrado.");
      if (device.customerId !== input.customerId) {
        throw new HttpError(422, "EQUIPAMENTO_NAO_PERTENCE_AO_CLIENTE", "O equipamento não pertence a este cliente.");
      }
      if (input.technicianId) await assertAssignableTechnician(db, auth.tenantId, input.technicianId);

      const protocol = await nextProtocol(db, auth.tenantId, deps.clock());
      const [order] = await db
        .insert(schema.workOrders)
        .values({
          tenantId: auth.tenantId,
          protocol,
          customerId: input.customerId,
          deviceId: input.deviceId,
          reportedDefect: input.reportedDefect,
          priority: input.priority,
          technicianId: input.technicianId,
          openedBy: auth.userId,
          idempotencyKey,
        })
        .returning();
      if (!order) throw new Error("insert de OS não retornou linha");

      await db.insert(schema.intakeInspections).values({
        tenantId: auth.tenantId,
        workOrderId: order.id,
        physicalCondition: input.inspection.physicalCondition,
        accessories: input.inspection.accessories,
        checklist: input.inspection.checklist,
        passwordInformed: input.inspection.passwordInformed,
        receivedBy: auth.userId,
      });
      await addEvent(db, { tenantId: auth.tenantId, workOrderId: order.id, type: "os_aberta", toState: order.state, actorUserId: auth.userId });
      await recordAudit(db, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: "work_order_opened",
        targetType: "work_order",
        targetId: order.id,
        outcome: "ok",
        correlationId: meta.correlationId,
        ip: meta.ip,
      });
      return { id: order.id, protocol: order.protocol, version: order.version, replay: false };
    });
  } catch (error) {
    // Duas requisições simultâneas com a mesma chave: a perdedora cai aqui, sem consumir protocolo.
    if (idempotencyKey && isUniqueViolation(error, IDEMPOTENCY_CONSTRAINT)) {
      return withContext(deps.pool, ctxOf(auth), async (db) => {
        const existing = await findByIdempotencyKey(db, auth.tenantId, idempotencyKey);
        if (!existing) throw error;
        return replayOf(existing, input);
      });
    }
    throw error;
  }
}

export async function assignTechnician(
  deps: AppServices,
  auth: AuthContext,
  orderId: string,
  input: { technicianId: string | null; version: number },
  meta: RequestMeta,
): Promise<{ version: number }> {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const order = await loadOrderForActor(db, auth, orderId, true);
    if (order.version !== input.version) {
      throw new HttpError(409, "CONFLITO_DE_VERSAO", "A OS foi alterada por outra pessoa. Recarregue e tente novamente.", {
        currentVersion: order.version,
      });
    }
    if (isClosedForChanges(order.state as WorkOrderState)) {
      throw new HttpError(422, "OS_ENCERRADA", "Esta OS não aceita mais alterações.");
    }
    if (input.technicianId) await assertAssignableTechnician(db, auth.tenantId, input.technicianId);

    const [updated] = await db
      .update(schema.workOrders)
      .set({ technicianId: input.technicianId, version: order.version + 1, updatedAt: new Date() })
      .where(and(eq(schema.workOrders.tenantId, auth.tenantId), eq(schema.workOrders.id, order.id), eq(schema.workOrders.version, order.version)))
      .returning({ version: schema.workOrders.version });
    if (!updated) throw orderNotFound();

    await addEvent(db, {
      tenantId: auth.tenantId,
      workOrderId: order.id,
      type: input.technicianId ? "tecnico_atribuido" : "tecnico_removido",
      actorUserId: auth.userId,
    });
    await recordAudit(db, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "work_order_assigned",
      targetType: "work_order",
      targetId: order.id,
      outcome: "ok",
      correlationId: meta.correlationId,
      ip: meta.ip,
    });
    return { version: updated.version };
  });
}
