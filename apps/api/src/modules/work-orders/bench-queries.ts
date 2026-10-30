import { schema, type Db } from "@reparo360/database";
import { and, asc, desc, eq } from "drizzle-orm";
import type { WorkOrderRow } from "./access.js";

/** Reparo, testes, entrega e origem de uma OS, para o detalhe. `restricted` oculta dados da retirada. */
export async function loadBenchData(db: Db, order: WorkOrderRow, restricted: boolean) {
  const tenantId = order.tenantId;

  const repairs = await db
    .select({
      id: schema.repairTasks.id,
      cycle: schema.repairTasks.cycle,
      procedure: schema.repairTasks.procedure,
      partsUsed: schema.repairTasks.partsUsed,
      outcome: schema.repairTasks.outcome,
      notes: schema.repairTasks.notes,
      authorId: schema.repairTasks.authorId,
      createdAt: schema.repairTasks.createdAt,
    })
    .from(schema.repairTasks)
    .where(and(eq(schema.repairTasks.tenantId, tenantId), eq(schema.repairTasks.workOrderId, order.id)))
    .orderBy(desc(schema.repairTasks.createdAt), desc(schema.repairTasks.id));

  const checks = await db
    .select()
    .from(schema.testChecks)
    .where(and(eq(schema.testChecks.tenantId, tenantId), eq(schema.testChecks.workOrderId, order.id)))
    .orderBy(asc(schema.testChecks.round), asc(schema.testChecks.item));
  const rounds = new Map<number, { round: number; cycle: number; recordedBy: string; createdAt: Date; results: Array<{ item: string; result: string; note: string | null }> }>();
  for (const check of checks) {
    const entry = rounds.get(check.round) ?? { round: check.round, cycle: check.cycle, recordedBy: check.recordedBy, createdAt: check.createdAt, results: [] };
    entry.results.push({ item: check.item, result: check.result, note: check.note });
    rounds.set(check.round, entry);
  }

  const [delivery] = restricted
    ? []
    : await db
        .select()
        .from(schema.deliveries)
        .where(and(eq(schema.deliveries.tenantId, tenantId), eq(schema.deliveries.workOrderId, order.id)))
        .limit(1);

  let origin: { id: string; protocol: string } | null = null;
  if (order.originWorkOrderId) {
    const [row] = await db
      .select({ id: schema.workOrders.id, protocol: schema.workOrders.protocol })
      .from(schema.workOrders)
      .where(and(eq(schema.workOrders.tenantId, tenantId), eq(schema.workOrders.id, order.originWorkOrderId)))
      .limit(1);
    origin = row ?? null;
  }

  return {
    repairs,
    testRounds: [...rounds.values()].reverse(),
    delivery: delivery
      ? {
          pickedUpByName: delivery.pickedUpByName,
          confirmationMethod: delivery.confirmationMethod,
          itemsReturned: delivery.itemsReturned,
          note: delivery.note,
          deliveredBy: delivery.deliveredBy,
          deliveredAt: delivery.deliveredAt,
        }
      : null,
    origin,
  };
}
