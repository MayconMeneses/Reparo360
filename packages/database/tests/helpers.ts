import { randomUUID } from "node:crypto";
import type pg from "pg";
import { createPool, runMigrations, schema, withContext } from "../src/index.js";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não definida (copie .env.example para .env)`);
  return value;
}

export interface Fixture {
  tenantA: string;
  tenantB: string;
  userA: string;
  userB: string;
  userBoth: string;
  sessionHashA: string;
  sessionHashB: string;
}

export interface Pools {
  /** Papel migrador: usado apenas para semear. Nunca para asserções de isolamento. */
  migrator: pg.Pool;
  /** Papel da aplicação: o único usado nas asserções. */
  app: pg.Pool;
}

export async function openPools(): Promise<Pools> {
  await runMigrations(requireEnv("TEST_MIGRATION_DATABASE_URL"));
  return {
    migrator: createPool(requireEnv("TEST_MIGRATION_DATABASE_URL"), 2),
    app: createPool(requireEnv("TEST_DATABASE_URL"), 2),
  };
}

/**
 * Semeia duas assistências sintéticas. O FORCE RLS vale também para o dono,
 * então até o migrador precisa informar o contexto de cada tenant ao inserir.
 */
export async function resetAndSeed(migrator: pg.Pool): Promise<Fixture> {
  await migrator.query("TRUNCATE audit_events, sessions, memberships, users, tenants CASCADE");
  const f: Fixture = {
    tenantA: randomUUID(),
    tenantB: randomUUID(),
    userA: randomUUID(),
    userB: randomUUID(),
    userBoth: randomUUID(),
    sessionHashA: `hash-a-${randomUUID()}`,
    sessionHashB: `hash-b-${randomUUID()}`,
  };
  const future = new Date(Date.now() + 3600_000);

  for (const [tenantId, label] of [[f.tenantA, "A"], [f.tenantB, "B"]] as const) {
    await withContext(migrator, { tenantId }, (db) =>
      db.insert(schema.tenants).values({ id: tenantId, name: `Assistência ${label}`, adminEmail: `admin-${label}@teste.invalid` }));
  }
  const users: Array<[string, string]> = [
    [f.userA, "a@teste.invalid"],
    [f.userB, "b@teste.invalid"],
    [f.userBoth, "ambos@teste.invalid"],
  ];
  for (const [id, email] of users) {
    await withContext(migrator, { userId: id }, (db) =>
      db.insert(schema.users).values({ id, email, name: "Sintético", passwordHash: "$argon2id$sintetico" }));
  }
  const members: Array<[string, string, string]> = [
    [f.tenantA, f.userA, "proprietario"],
    [f.tenantB, f.userB, "proprietario"],
    [f.tenantA, f.userBoth, "atendente"],
    [f.tenantB, f.userBoth, "tecnico"],
  ];
  for (const [tenantId, userId, role] of members) {
    await withContext(migrator, { tenantId }, (db) => db.insert(schema.memberships).values({ tenantId, userId, role }));
  }
  const sessions: Array<[string, string, string]> = [
    [f.tenantA, f.userA, f.sessionHashA],
    [f.tenantB, f.userB, f.sessionHashB],
  ];
  for (const [tenantId, userId, tokenHash] of sessions) {
    await withContext(migrator, { tenantId }, async (db) => {
      await db.insert(schema.sessions).values({ tokenHash, userId, tenantId, csrfToken: "csrf-sintetico", expiresAt: future });
      await db.insert(schema.auditEvents).values({ tenantId, actorUserId: userId, action: "seed", outcome: "ok" });
    });
  }
  return f;
}
