import { boolean, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns.js";

/** Assistência técnica. O próprio id é o tenant. */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tradeName: text("trade_name"),
  adminEmail: text("admin_email").notNull(),
  phone: text("phone"),
  status: text("status").notNull().default("em_configuracao"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Identidade global. E-mail é guardado em minúsculas. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  /** Senha temporária (conta criada pelo Master): nada funciona até o usuário definir a própria. */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  status: text("status").notNull().default("ativo"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: text("role").notNull(),
    status: text("status").notNull().default("ativo"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("memberships_tenant_user_key").on(t.tenantId, t.userId), index("memberships_user_idx").on(t.userId)],
);

/** Sessão opaca: o cookie carrega o token; aqui fica só o hash SHA-256. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    csrfToken: text("csrf_token").notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastAuthAt: timestamp("last_auth_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Trilha append-only. tenant_id nulo = evento sem empresa definida (ex.: login falho). */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    outcome: text("outcome").notNull(),
    /** Motivo informado em ações do Master sobre a empresa. */
    reason: text("reason"),
    correlationId: text("correlation_id"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_tenant_created_idx").on(t.tenantId, t.createdAt)],
);
