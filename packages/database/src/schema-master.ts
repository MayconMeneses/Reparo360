// Fase 6: administração da plataforma (Master). Identidade, sessões e desafios de MFA separados dos da empresa.
import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./columns.js";

/** Operador da plataforma. A aplicação não lê esta tabela direto: só por funções restritas (migração 0011). */
export const platformAdmins = pgTable("platform_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  /** Segredo TOTP cifrado (AES-GCM) com chave fora do banco. */
  totpSecretEnc: text("totp_secret_enc").notNull(),
  /** Último passo de 30 s aceito: um código já usado nunca vale de novo. */
  totpLastStep: bigint("totp_last_step", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("ativo"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Etapa entre a senha e o código MFA. Só o hash do token fica aqui. */
export const platformChallenges = pgTable(
  "platform_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id").notNull().references(() => platformAdmins.id),
    tokenHash: text("token_hash").notNull().unique(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("platform_challenges_admin_idx").on(t.adminId)],
);

/** Sessão do Master: só existe depois da senha E do código MFA. */
export const platformSessions = pgTable(
  "platform_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    adminId: uuid("admin_id").notNull().references(() => platformAdmins.id),
    csrfToken: text("csrf_token").notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastAuthAt: timestamp("last_auth_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("platform_sessions_admin_idx").on(t.adminId)],
);
