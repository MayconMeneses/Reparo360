import { sql, type SQL } from "drizzle-orm";
import { timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** CHECK de lista fechada, gerado a partir das constantes do domínio (uma só fonte). */
export const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
