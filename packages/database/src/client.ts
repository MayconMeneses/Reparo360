import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema-all.js";

export type Db = NodePgDatabase<typeof schema>;

/** Contexto de segurança de uma transação. Valores ausentes não são definidos. */
export interface DbContext {
  tenantId?: string;
  userId?: string;
  sessionHash?: string;
}

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

/**
 * Executa `fn` em uma transação com o contexto aplicado via SET LOCAL
 * (set_config com is_local = true). O contexto morre com a transação, então
 * conexões reutilizadas pelo pool não carregam tenant de uma requisição para outra.
 */
export async function withContext<T>(pool: pg.Pool, ctx: DbContext, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const settings: Array<[string, string | undefined]> = [
      ["app.tenant_id", ctx.tenantId],
      ["app.user_id", ctx.userId],
      ["app.session_hash", ctx.sessionHash],
    ];
    for (const [key, value] of settings) {
      if (value !== undefined) await client.query("SELECT set_config($1, $2, true)", [key, value]);
    }
    const result = await fn(drizzle(client, { schema }));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
