// Fase 5: acesso do consumidor ao acompanhamento da OS (somente leitura).
import { sql } from "drizzle-orm";
import { foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./columns.js";
import { users } from "./schema.js";
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
  ],
);
