import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Deve ser executada com o papel migrador, nunca com o papel da aplicação. */
export async function runMigrations(migrationUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: migrationUrl, max: 1 });
  try {
    await drizzleMigrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
