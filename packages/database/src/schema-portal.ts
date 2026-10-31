// Fase 5: acesso do consumidor ao acompanhamento da OS (somente leitura).
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./columns.js";
import { users } from "./schema.js";
import { quoteVersions } from "./schema-quotes.js";
import { workOrders } from "./schema-workflow.js";

/**
 * Link individual do consumidor. O token (256 bits) só existe no momento da criação;
 * aqui fica o hash. No máximo um link ativo por OS: gerar outro revoga o anterior.
 */
export const customerAccessGrants = pgTable(
  "customer_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    workOrderId: uuid("work_order_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ name: "grants_work_order_fk", columns: [t.tenantId, t.workOrderId], foreignColumns: [workOrders.tenantId, workOrders.id] }),
    uniqueIndex("grants_one_active_per_order").on(t.tenantId, t.workOrderId).where(sql`${t.revokedAt} is null`),
    index("grants_order_idx").on(t.tenantId, t.workOrderId),
    unique("grants_tenant_id_unique").on(t.tenantId, t.id),
  ],
);

/**
 * Código de uso único enviado ao e-mail cadastrado do cliente para confirmar uma decisão remota (P-03).
 * Preso a uma versão do orçamento. Só o HMAC do código fica aqui; tentativas e consumo são atualizáveis.
 */
export const customerVerifications = pgTable(
  "customer_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    grantId: uuid("grant_id").notNull(),
    quoteVersionId: uuid("quote_version_id").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "verifications_grant_fk", columns: [t.tenantId, t.grantId], foreignColumns: [customerAccessGrants.tenantId, customerAccessGrants.id] }),
    foreignKey({ name: "verifications_quote_fk", columns: [t.tenantId, t.quoteVersionId], foreignColumns: [quoteVersions.tenantId, quoteVersions.id] }),
    unique("verifications_tenant_id_unique").on(t.tenantId, t.id),
    index("verifications_grant_idx").on(t.tenantId, t.grantId, t.createdAt),
    check("verifications_attempts_ck", sql`${t.attempts} >= 0`),
  ],
);
