// Fase 3: diagnóstico e orçamento versionado.
import { DIAGNOSTIC_NATURES, QUOTE_ITEM_KINDS, QUOTE_STATES } from "@reparo360/domain";
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, oneOf, updatedAt } from "./columns.js";
import { users } from "./schema.js";
import { workOrders } from "./schema-workflow.js";

/** Diagnóstico técnico. Append-only: corrigir é registrar nova revisão. */
export const diagnostics = pgTable(
  "diagnostics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workOrderId: uuid("work_order_id").notNull(),
    revision: integer("revision").notNull(),
    nature: text("nature").notNull(),
    symptoms: text("symptoms").notNull(),
    checksPerformed: text("checks_performed").notNull(),
    findings: text("findings"),
    recommendedServices: text("recommended_services"),
    notes: text("notes"),
    authorId: uuid("author_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "diagnostics_work_order_fk", columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id] }),
    unique("diagnostics_tenant_id_key").on(t.tenantId, t.id),
    unique("diagnostics_order_revision_key").on(t.tenantId, t.workOrderId, t.revision),
    check("diagnostics_nature_ck", oneOf(t.nature, DIAGNOSTIC_NATURES)),
    // Suspeita e confirmado precisam dizer qual é o defeito; só o inconclusivo pode omitir.
    check("diagnostics_findings_ck", sql`${t.nature} = 'inconclusivo' or ${t.findings} is not null`),
  ],
);

/** Versão do orçamento. Conteúdo é imutável a partir do envio (gatilho no banco). */
export const quoteVersions = pgTable(
  "quote_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workOrderId: uuid("work_order_id").notNull(),
    number: integer("number").notNull(),
    state: text("state").notNull().default("rascunho"),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull().default(0),
    discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    paymentTerms: text("payment_terms"),
    estimatedDays: integer("estimated_days"),
    notes: text("notes"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    basedOnDiagnosticId: uuid("based_on_diagnostic_id"),
    /** Quem autorizou orçar sobre diagnóstico apenas suspeito (P-09). */
    suspicionAuthorizedBy: uuid("suspicion_authorized_by").references(() => users.id),
    /** Controle otimista do rascunho. */
    revision: integer("revision").notNull().default(1),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    submittedBy: uuid("submitted_by").references(() => users.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ name: "quote_versions_work_order_fk", columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id] }),
    foreignKey({ name: "quote_versions_diagnostic_fk", columns: [t.tenantId, t.basedOnDiagnosticId], foreignColumns: [diagnostics.tenantId, diagnostics.id] }),
    unique("quote_versions_tenant_id_key").on(t.tenantId, t.id),
    unique("quote_versions_order_number_key").on(t.tenantId, t.workOrderId, t.number),
    // No máximo uma versão aberta (rascunho ou enviada) por OS.
    uniqueIndex("quote_versions_one_open_per_order").on(t.tenantId, t.workOrderId).where(sql`${t.state} in ('rascunho', 'enviado')`),
    index("quote_versions_due_idx").on(t.tenantId, t.state, t.validUntil),
    check("quote_versions_state_ck", oneOf(t.state, QUOTE_STATES)),
    check("quote_versions_money_ck", sql`${t.subtotalCents} >= 0 and ${t.discountCents} >= 0 and ${t.discountCents} <= ${t.subtotalCents} and ${t.totalCents} = ${t.subtotalCents} - ${t.discountCents}`),
    check("quote_versions_days_ck", sql`${t.estimatedDays} is null or ${t.estimatedDays} > 0`),
    // Quem saiu do rascunho tem prazo, condições e base de diagnóstico.
    check("quote_versions_sent_ck", sql`${t.state} = 'rascunho' or (${t.validUntil} is not null and ${t.paymentTerms} is not null and ${t.estimatedDays} is not null and ${t.basedOnDiagnosticId} is not null and ${t.submittedAt} is not null)`),
  ],
);

export const quoteItems = pgTable(
  "quote_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    quoteVersionId: uuid("quote_version_id").notNull(),
    position: integer("position").notNull(),
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({ name: "quote_items_version_fk", columns: [t.tenantId, t.quoteVersionId], foreignColumns: [quoteVersions.tenantId, quoteVersions.id] }),
    unique("quote_items_version_position_key").on(t.tenantId, t.quoteVersionId, t.position),
    check("quote_items_kind_ck", oneOf(t.kind, QUOTE_ITEM_KINDS)),
    check("quote_items_values_ck", sql`${t.quantity} > 0 and ${t.quantity} <= 1000 and ${t.unitPriceCents} >= 0`),
  ],
);

/** Decisão sobre uma versão específica. Uma por versão: dá idempotência real. */
export const quoteDecisions = pgTable(
  "quote_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    quoteVersionId: uuid("quote_version_id").notNull(),
    decision: text("decision").notNull(),
    /** "remoto" existe no esquema mas não é gravado até a decisão P-03. */
    channel: text("channel").notNull(),
    /** Funcionário que registrou a decisão. */
    decidedBy: uuid("decided_by").notNull().references(() => users.id),
    /** Nome de quem decidiu pelo cliente (aprovação presencial). */
    confirmedByName: text("confirmed_by_name").notNull(),
    note: text("note"),
    partUnavailable: boolean("part_unavailable").notNull().default(false),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "quote_decisions_version_fk", columns: [t.tenantId, t.quoteVersionId], foreignColumns: [quoteVersions.tenantId, quoteVersions.id] }),
    unique("quote_decisions_one_per_version").on(t.tenantId, t.quoteVersionId),
    check("quote_decisions_decision_ck", oneOf(t.decision, ["aprovado", "recusado"])),
    check("quote_decisions_channel_ck", oneOf(t.channel, ["presencial", "remoto"])),
  ],
);
