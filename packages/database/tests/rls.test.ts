import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, schema, withContext } from "../src/index.js";
import { openPools, requireEnv, resetAndSeed, type Fixture, type Pools } from "./helpers.js";

let pools: Pools;
let f: Fixture;

beforeAll(async () => {
  pools = await openPools();
  f = await resetAndSeed(pools.migrator);
});

afterAll(async () => {
  await pools.app.end();
  await pools.migrator.end();
});

describe("catálogo do banco", () => {
  it("o papel da aplicação não é superusuário, não contorna RLS e não é dono de tabelas", async () => {
    const role = await pools.app.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await pools.app.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user");
    expect(owned.rows[0].n).toBe(0);
  });

  it("toda tabela com tenant_id tem RLS ativada e forçada", async () => {
    const res = await pools.app.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r' AND (
        c.relname = 'tenants'
        OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
      )`);
    const names = res.rows.map((r) => r.relname).sort();
    // Lista deliberada: tabela nova com tenant_id faz este teste falhar até ser incluída com RLS.
    expect(names).toEqual([
      "attachments",
      "audit_events",
      "customers",
      "deliveries",
      "devices",
      "diagnostics",
      "intake_inspections",
      "memberships",
      "protocol_counters",
      "quote_decisions",
      "quote_items",
      "quote_versions",
      "repair_tasks",
      "sessions",
      "tenants",
      "test_checks",
      "work_order_events",
      "work_orders",
    ]);
    for (const row of res.rows) {
      expect(row.relrowsecurity, `${row.relname} sem RLS`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} sem FORCE`).toBe(true);
    }
  });

  it("toda política que escreve tem WITH CHECK (não permite mover linha para outro tenant)", async () => {
    const res = await pools.app.query(
      "SELECT tablename, policyname, cmd, with_check FROM pg_policies WHERE schemaname = 'public' AND cmd IN ('ALL', 'INSERT', 'UPDATE')",
    );
    expect(res.rows.length).toBeGreaterThan(0);
    for (const row of res.rows) expect(row.with_check, `${row.tablename}.${row.policyname}`).not.toBeNull();
  });

  it("users (global) tem RLS ativada", async () => {
    const res = await pools.app.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'users'");
    expect(res.rows[0].relrowsecurity).toBe(true);
  });
});

describe("isolamento entre Assistência A e B", () => {
  it("o contexto de A só enxerga dados de A", async () => {
    const tenants = await withContext(pools.app, { tenantId: f.tenantA }, (db) => db.select().from(schema.tenants));
    expect(tenants.map((t) => t.id)).toEqual([f.tenantA]);
    const members = await withContext(pools.app, { tenantId: f.tenantA }, (db) => db.select().from(schema.memberships));
    expect(members.every((m) => m.tenantId === f.tenantA)).toBe(true);
    expect(members).toHaveLength(2);
  });

  it("usuário membro de A e B não vê as linhas de B numa requisição do tenant A", async () => {
    const members = await withContext(pools.app, { tenantId: f.tenantA, userId: f.userBoth }, (db) => db.select().from(schema.memberships));
    expect(members.map((m) => m.tenantId)).toEqual([f.tenantA, f.tenantA]);
  });

  it("sem contexto nada é visível", async () => {
    expect(await withContext(pools.app, {}, (db) => db.select().from(schema.tenants))).toHaveLength(0);
    expect(await withContext(pools.app, {}, (db) => db.select().from(schema.memberships))).toHaveLength(0);
    expect(await withContext(pools.app, {}, (db) => db.select().from(schema.users))).toHaveLength(0);
  });

  it("sem tenant, o usuário vê só as próprias empresas", async () => {
    const both = await withContext(pools.app, { userId: f.userBoth }, (db) => db.select().from(schema.tenants));
    expect(both.map((t) => t.id).sort()).toEqual([f.tenantA, f.tenantB].sort());
    const single = await withContext(pools.app, { userId: f.userA }, (db) => db.select().from(schema.tenants));
    expect(single.map((t) => t.id)).toEqual([f.tenantA]);
  });

  it("A não consegue ler nem alterar a empresa B", async () => {
    const read = await withContext(pools.app, { tenantId: f.tenantA }, (db) =>
      db.select().from(schema.tenants).where(eq(schema.tenants.id, f.tenantB)));
    expect(read).toHaveLength(0);
    const updated = await withContext(pools.app, { tenantId: f.tenantA }, (db) =>
      db.update(schema.tenants).set({ name: "invadida" }).where(eq(schema.tenants.id, f.tenantB)).returning());
    expect(updated).toHaveLength(0);
    const untouched = await withContext(pools.migrator, { tenantId: f.tenantB }, (db) =>
      db.select().from(schema.tenants).where(eq(schema.tenants.id, f.tenantB)));
    expect(untouched[0]?.name).toBe("Assistência B");
  });

  it("A não consegue inserir vínculo na empresa B", async () => {
    await expect(
      withContext(pools.app, { tenantId: f.tenantA }, (db) =>
        db.insert(schema.memberships).values({ tenantId: f.tenantB, userId: f.userA, role: "proprietario" })),
    ).rejects.toThrow();
  });

  it("A não consegue mover uma linha sua para B (WITH CHECK)", async () => {
    await expect(
      withContext(pools.app, { tenantId: f.tenantA }, (db) =>
        db.update(schema.memberships).set({ tenantId: f.tenantB }).where(eq(schema.memberships.userId, f.userA))),
    ).rejects.toThrow();
    const still = await withContext(pools.app, { tenantId: f.tenantA }, (db) =>
      db.select().from(schema.memberships).where(eq(schema.memberships.userId, f.userA)));
    expect(still).toHaveLength(1);
  });

  it("A não enxerga usuários exclusivos de B", async () => {
    const users = await withContext(pools.app, { tenantId: f.tenantA }, (db) => db.select().from(schema.users));
    const ids = users.map((u) => u.id);
    expect(ids).toContain(f.userA);
    expect(ids).not.toContain(f.userB);
  });

  it("sessões: só por tenant ou pelo hash informado", async () => {
    const byHash = await withContext(pools.app, { sessionHash: f.sessionHashA }, (db) => db.select().from(schema.sessions));
    expect(byHash.map((s) => s.tenantId)).toEqual([f.tenantA]);
    const wrong = await withContext(pools.app, { sessionHash: "inexistente" }, (db) => db.select().from(schema.sessions));
    expect(wrong).toHaveLength(0);
    const fromA = await withContext(pools.app, { tenantId: f.tenantA }, (db) => db.select().from(schema.sessions));
    expect(fromA.every((s) => s.tenantId === f.tenantA)).toBe(true);
  });
});

describe("vazamento de contexto em conexão reutilizada", () => {
  it("o tenant de uma transação não persiste na seguinte", async () => {
    const single = createPool(requireEnv("TEST_DATABASE_URL"), 1);
    try {
      const during = await withContext(single, { tenantId: f.tenantA }, (db) => db.select().from(schema.tenants));
      expect(during).toHaveLength(1);
      // Mesma conexão física (max = 1), agora sem contexto.
      const after = await withContext(single, {}, (db) => db.select().from(schema.tenants));
      expect(after).toHaveLength(0);
    } finally {
      await single.end();
    }
  });
});

describe("auditoria append-only", () => {
  it("aplicação insere e lê só da própria empresa", async () => {
    await withContext(pools.app, { tenantId: f.tenantA }, (db) =>
      db.insert(schema.auditEvents).values({ tenantId: f.tenantA, action: "teste", outcome: "ok" }));
    const rows = await withContext(pools.app, { tenantId: f.tenantA }, (db) => db.select().from(schema.auditEvents));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === f.tenantA)).toBe(true);
  });

  it("aplicação não grava evento em nome de outra empresa", async () => {
    await expect(
      withContext(pools.app, { tenantId: f.tenantA }, (db) =>
        db.insert(schema.auditEvents).values({ tenantId: f.tenantB, action: "forjado", outcome: "ok" })),
    ).rejects.toThrow();
  });

  it("evento sem empresa (login falho) pode ser gravado", async () => {
    await withContext(pools.app, {}, (db) => db.insert(schema.auditEvents).values({ action: "login_falho", outcome: "negado" }));
  });

  it("UPDATE e DELETE são negados pelo banco (permission denied)", async () => {
    for (const statement of ["UPDATE audit_events SET outcome = 'x'", "DELETE FROM audit_events"]) {
      const error = await withContext(pools.app, { tenantId: f.tenantA }, (db) => db.execute(sql.raw(statement))).then(
        () => null,
        (e: unknown) => e,
      );
      // O Drizzle embrulha o erro do driver; a causa real do PostgreSQL fica em `cause`.
      const cause = (error as { cause?: { code?: string; message?: string } } | null)?.cause;
      expect(cause?.code, statement).toBe("42501");
      expect(cause?.message).toMatch(/permission denied/i);
    }
  });
});

describe("consulta de login", () => {
  it("encontra o usuário por e-mail sem diferenciar maiúsculas e devolve só os campos necessários", async () => {
    const res = await pools.app.query("SELECT * FROM app_login_lookup($1)", ["A@Teste.invalid"]);
    expect(res.rows).toHaveLength(1);
    expect(Object.keys(res.rows[0]).sort()).toEqual(["id", "password_hash", "status"]);
  });

  it("e-mail inexistente devolve zero linhas", async () => {
    const res = await pools.app.query("SELECT * FROM app_login_lookup($1)", ["ninguem@teste.invalid"]);
    expect(res.rows).toHaveLength(0);
  });
});
