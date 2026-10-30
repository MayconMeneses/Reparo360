// Fase 4: reparo, testes finais e entrega. Tudo append-only (SELECT/INSERT): correção é novo registro.
import { DELIVERY_CONFIRMATIONS, REPAIR_OUTCOMES, TEST_RESULTS } from "@reparo360/domain";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, oneOf } from "./columns.js";
import { users } from "./schema.js";
import { workOrders } from "./schema-workflow.js";

export const repairTasks = pgTable(
  "repair_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workOrderId: uuid("work_order_id").notNull(),
    /** work_orders.repair_cycle no momento do registro. */
    cycle: integer("cycle").notNull(),
    procedure: text("procedure").notNull(),
    /** Peças usadas, em texto livre (estoque é V2). */
    partsUsed: text("parts_used"),
    outcome: text("outcome").notNull(),
    notes: text("notes"),
    authorId: uuid("author_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "repair_tasks_work_order_fk", columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id] }),
    index("repair_tasks_order_cycle_idx").on(t.tenantId, t.workOrderId, t.cycle),
    check("repair_tasks_outcome_ck", oneOf(t.outcome, REPAIR_OUTCOMES)),
    check("repair_tasks_cycle_ck", sql`${t.cycle} >= 1`),
  ],
);

/** Uma linha por item de uma rodada de testes. A rodada efetiva do ciclo é a de maior `round`. */
export const testChecks = pgTable(
  "test_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workOrderId: uuid("work_order_id").notNull(),
    /** work_orders.test_cycle no momento do registro. */
    cycle: integer("cycle").notNull(),
    round: integer("round").notNull(),
    item: text("item").notNull(),
    result: text("result").notNull(),
    note: text("note"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "test_checks_work_order_fk", columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id] }),
    unique("test_checks_round_item_key").on(t.tenantId, t.workOrderId, t.round, t.item),
    index("test_checks_order_cycle_idx").on(t.tenantId, t.workOrderId, t.cycle, t.round),
    check("test_checks_result_ck", oneOf(t.result, TEST_RESULTS)),
    check("test_checks_cycle_ck", sql`${t.cycle} >= 1 and ${t.round} >= 1`),
  ],
);

/** Entrega do equipamento. Uma por OS. Não guarda número de documento do cliente. */
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workOrderId: uuid("work_order_id").notNull(),
    deliveredBy: uuid("delivered_by").notNull().references(() => users.id),
    pickedUpByName: text("picked_up_by_name").notNull(),
    confirmationMethod: text("confirmation_method").notNull(),
    itemsReturned: jsonb("items_returned").$type<string[]>().notNull(),
    note: text("note"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "deliveries_work_order_fk", columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id] }),
    unique("deliveries_one_per_order").on(t.tenantId, t.workOrderId),
    check("deliveries_method_ck", oneOf(t.confirmationMethod, DELIVERY_CONFIRMATIONS)),
  ],
);
