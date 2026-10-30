// Fase 2: clientes, equipamentos, ordens de serviço e anexos.
// Toda FK entre tabelas de tenant é composta (tenant_id, ...) para que o banco
// recuse vínculo entre empresas diferentes, mesmo que a RLS seja contornada.
import {
  ATTACHMENT_TYPES,
  DEVICE_CATEGORIES,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATES,
  type ChecklistResult,
} from "@reparo360/domain";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, oneOf, updatedAt } from "./columns.js";
import { memberships, tenants, users } from "./schema.js";

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    /** Somente dígitos (ver normalizePhone). */
    phone: text("phone").notNull(),
    email: text("email"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customers_tenant_id_key").on(t.tenantId, t.id),
    index("customers_tenant_phone_idx").on(t.tenantId, t.phone),
    index("customers_tenant_created_idx").on(t.tenantId, t.createdAt, t.id),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    category: text("category").notNull(),
    brand: text("brand").notNull(),
    model: text("model").notNull(),
    color: text("color"),
    serialNumber: text("serial_number"),
    imei: text("imei"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "devices_customer_fk", columns: [t.tenantId, t.customerId], foreignColumns: [customers.tenantId, customers.id] }),
    // Alvo da FK de work_orders: a OS só aponta para equipamento DO cliente da OS.
    unique("devices_tenant_customer_id_key").on(t.tenantId, t.customerId, t.id),
    index("devices_tenant_customer_idx").on(t.tenantId, t.customerId),
    check("devices_category_ck", oneOf(t.category, DEVICE_CATEGORIES)),
    check("devices_imei_ck", sql`${t.imei} is null or ${t.imei} ~ '^[0-9]{15}$'`),
  ],
);

/** Contador de protocolo por empresa e ano. Linha travada na transação: sem lacunas em rollback. */
export const protocolCounters = pgTable(
  "protocol_counters",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    year: integer("year").notNull(),
    lastNumber: integer("last_number").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.year] })],
);

export const workOrders = pgTable(
  "work_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    protocol: text("protocol").notNull(),
    customerId: uuid("customer_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    reportedDefect: text("reported_defect").notNull(),
    state: text("state").notNull().default("RECEBIDA"),
    priority: text("priority").notNull().default("normal"),
    technicianId: uuid("technician_id"),
    openedBy: uuid("opened_by").notNull().references(() => users.id),
    /** Controle otimista: toda alteração incrementa; o cliente informa a versão que viu. */
    version: integer("version").notNull().default(1),
    /** Chave enviada pelo cliente para tornar a abertura idempotente (duplo clique). */
    idempotencyKey: text("idempotency_key"),
    /** Quantas vezes a OS entrou em EM_REPARO / EM_TESTE. Ancora tarefas e rodadas ao ciclo atual (sem comparar horários). */
    repairCycle: integer("repair_cycle").notNull().default(0),
    testCycle: integer("test_cycle").notNull().default(0),
    /** Retorno ou reclamação posterior: aponta para a OS anterior da mesma empresa (RN-007). */
    originWorkOrderId: uuid("origin_work_order_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "work_orders_origin_fk", columns: [t.tenantId, t.originWorkOrderId], foreignColumns: [t.tenantId, t.id] }),
    foreignKey({
      name: "work_orders_device_fk",
      columns: [t.tenantId, t.customerId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.customerId, devices.id],
    }),
    foreignKey({
      name: "work_orders_technician_fk",
      columns: [t.tenantId, t.technicianId],
      foreignColumns: [memberships.tenantId, memberships.userId],
    }),
    unique("work_orders_tenant_id_key").on(t.tenantId, t.id),
    unique("work_orders_tenant_protocol_key").on(t.tenantId, t.protocol),
    unique("work_orders_tenant_idempotency_key").on(t.tenantId, t.idempotencyKey),
    index("work_orders_tenant_state_idx").on(t.tenantId, t.state, t.createdAt, t.id),
    index("work_orders_tenant_technician_idx").on(t.tenantId, t.technicianId),
    check("work_orders_state_ck", oneOf(t.state, WORK_ORDER_STATES)),
    check("work_orders_priority_ck", oneOf(t.priority, WORK_ORDER_PRIORITIES)),
  ],
);

/** Registro do recebimento. Imutável: correções viram eventos, não UPDATE. */
export const intakeInspections = pgTable(
  "intake_inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workOrderId: uuid("work_order_id").notNull(),
    physicalCondition: text("physical_condition").notNull(),
    accessories: jsonb("accessories").$type<string[]>().notNull(),
    checklist: jsonb("checklist").$type<Array<{ item: string; result: ChecklistResult }>>().notNull(),
    /** Só registra se a senha foi informada. A senha em si nunca é armazenada (P-08). */
    passwordInformed: boolean("password_informed").notNull().default(false),
    receivedBy: uuid("received_by").notNull().references(() => users.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "intake_work_order_fk", columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id] }),
    unique("intake_tenant_work_order_key").on(t.tenantId, t.workOrderId),
  ],
);

/** Histórico append-only da OS. */
export const workOrderEvents = pgTable(
  "work_order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workOrderId: uuid("work_order_id").notNull(),
    type: text("type").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    /** Nulo apenas em eventos do sistema (expiração automática); nunca se atribui a uma pessoa que não agiu. */
    actorUserId: uuid("actor_user_id").references(() => users.id),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "events_work_order_fk", columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id] }),
    index("events_work_order_idx").on(t.tenantId, t.workOrderId, t.createdAt),
    check("events_actor_ck", sql`${t.actorUserId} is not null or ${t.type} = 'orcamento_expirado'`),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workOrderId: uuid("work_order_id").notNull(),
    /** Chave gerada pelo servidor (nunca derivada do nome enviado). */
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id),
  },
  (t) => [
    foreignKey({ name: "attachments_work_order_fk", columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id] }),
    index("attachments_work_order_idx").on(t.tenantId, t.workOrderId),
    check("attachments_type_ck", oneOf(t.contentType, ATTACHMENT_TYPES)),
  ],
);
