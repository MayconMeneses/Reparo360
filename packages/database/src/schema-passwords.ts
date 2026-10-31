// Fase 6+: redefinição de senha e convite por e-mail. Tabela global (a conta ainda não tem sessão nem empresa ativa).
import { index, pgTable, text, timestamp, uuid, check } from "drizzle-orm/pg-core";
import { createdAt, oneOf } from "./columns.js";
import { users } from "./schema.js";

/**
 * Token de uso único enviado por e-mail. Só o hash do token fica aqui. A aplicação não tem privilégio algum nesta
 * tabela: tudo passa por funções restritas (migração 0014), que conferem validade e uso numa única operação.
 */
export const passwordTokens = pgTable(
  "password_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    purpose: text("purpose").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("password_tokens_user_idx").on(t.userId, t.createdAt),
    check("password_tokens_purpose_ck", oneOf(t.purpose, ["redefinicao", "convite"])),
  ],
);
