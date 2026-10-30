import { schema, withContext } from "@reparo360/database";
import { isRestrictedToAssigned, type WorkOrderState } from "@reparo360/domain";
import { and, asc, desc, eq, ilike, isNull } from "drizzle-orm";
import type { AuthContext } from "../../auth-context.js";
import type { AppServices } from "../../services.js";
import { listDiagnostics } from "../diagnostics/diagnostics.js";
import { loadQuotes } from "../quotes/quote-access.js";
import { loadBenchData } from "./bench-queries.js";
import { escapeLike } from "../shared/query.js";
import { loadOrderForActor, visibleToActor } from "./access.js";

const ctxOf = (auth: AuthContext) => ({ tenantId: auth.tenantId, userId: auth.userId });

export async function listWorkOrders(
  deps: AppServices,
  auth: AuthContext,
  query: { state?: WorkOrderState; q?: string; limit: number; offset: number },
) {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const rows = await db
      .select({
        id: schema.workOrders.id,
        protocol: schema.workOrders.protocol,
        state: schema.workOrders.state,
        priority: schema.workOrders.priority,
        technicianId: schema.workOrders.technicianId,
        createdAt: schema.workOrders.createdAt,
        customerName: schema.customers.name,
        category: schema.devices.category,
        brand: schema.devices.brand,
        model: schema.devices.model,
      })
      .from(schema.workOrders)
      .innerJoin(schema.customers, and(eq(schema.customers.tenantId, schema.workOrders.tenantId), eq(schema.customers.id, schema.workOrders.customerId)))
      .innerJoin(schema.devices, and(eq(schema.devices.tenantId, schema.workOrders.tenantId), eq(schema.devices.id, schema.workOrders.deviceId)))
      .where(and(
        eq(schema.workOrders.tenantId, auth.tenantId),
        visibleToActor(auth),
        query.state ? eq(schema.workOrders.state, query.state) : undefined,
        query.q ? ilike(schema.workOrders.protocol, `${escapeLike(query.q)}%`) : undefined,
      ))
      .orderBy(desc(schema.workOrders.createdAt), desc(schema.workOrders.id))
      .limit(query.limit)
      .offset(query.offset);
    return rows.map((row) => ({
      id: row.id,
      protocol: row.protocol,
      state: row.state,
      priority: row.priority,
      technicianId: row.technicianId,
      createdAt: row.createdAt,
      customerName: row.customerName,
      device: { category: row.category, brand: row.brand, model: row.model },
    }));
  });
}

export async function getWorkOrder(deps: AppServices, auth: AuthContext, orderId: string) {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const order = await loadOrderForActor(db, auth, orderId);

    const [customer] = await db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, auth.tenantId), eq(schema.customers.id, order.customerId)))
      .limit(1);
    const [device] = await db
      .select()
      .from(schema.devices)
      .where(and(eq(schema.devices.tenantId, auth.tenantId), eq(schema.devices.id, order.deviceId)))
      .limit(1);
    const [inspection] = await db
      .select()
      .from(schema.intakeInspections)
      .where(and(eq(schema.intakeInspections.tenantId, auth.tenantId), eq(schema.intakeInspections.workOrderId, order.id)))
      .limit(1);
    const events = await db
      .select({
        type: schema.workOrderEvents.type,
        fromState: schema.workOrderEvents.fromState,
        toState: schema.workOrderEvents.toState,
        actorUserId: schema.workOrderEvents.actorUserId,
        reason: schema.workOrderEvents.reason,
        createdAt: schema.workOrderEvents.createdAt,
      })
      .from(schema.workOrderEvents)
      .where(and(eq(schema.workOrderEvents.tenantId, auth.tenantId), eq(schema.workOrderEvents.workOrderId, order.id)))
      .orderBy(asc(schema.workOrderEvents.createdAt), asc(schema.workOrderEvents.id));
    const attachments = await db
      .select({
        id: schema.attachments.id,
        contentType: schema.attachments.contentType,
        sizeBytes: schema.attachments.sizeBytes,
        createdAt: schema.attachments.createdAt,
      })
      .from(schema.attachments)
      .where(and(eq(schema.attachments.tenantId, auth.tenantId), eq(schema.attachments.workOrderId, order.id), isNull(schema.attachments.deletedAt)))
      .orderBy(asc(schema.attachments.createdAt));

    // Técnico enxerga o necessário para o reparo; telefone e e-mail do cliente ficam de fora.
    const restricted = isRestrictedToAssigned(auth.role);
    return {
      id: order.id,
      protocol: order.protocol,
      state: order.state,
      priority: order.priority,
      reportedDefect: order.reportedDefect,
      technicianId: order.technicianId,
      version: order.version,
      repairCycle: order.repairCycle,
      testCycle: order.testCycle,
      createdAt: order.createdAt,
      customer: customer
        ? restricted
          ? { id: customer.id, name: customer.name }
          : { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email }
        : null,
      device: device
        ? { id: device.id, category: device.category, brand: device.brand, model: device.model, color: device.color, serialNumber: device.serialNumber, imei: device.imei }
        : null,
      inspection: inspection
        ? {
            physicalCondition: inspection.physicalCondition,
            accessories: inspection.accessories,
            checklist: inspection.checklist,
            passwordInformed: inspection.passwordInformed,
            receivedBy: inspection.receivedBy,
            receivedAt: inspection.receivedAt,
          }
        : null,
      events,
      attachments,
      diagnostics: await listDiagnostics(db, auth.tenantId, order.id),
      quotes: await loadQuotes(db, auth.tenantId, order.id),
      ...(await loadBenchData(db, order, restricted)),
    };
  });
}
