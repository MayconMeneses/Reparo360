import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withContext, type Db } from "../src/index.js";
import { openPools, resetAndSeed, sqlState, type Fixture, type Pools } from "./helpers.js";

let pools: Pools;
let f: Fixture;
const ids = { customerA: randomUUID(), deviceA: randomUUID(), orderA: randomUUID(), orderA2: randomUUID(), customerB: randomUUID(), deviceB: randomUUID(), orderB: randomUUID() };
const HASH_A = `hash-grant-a-${randomUUID()}`;
const HASH_B = `hash-grant-b-${randomUUID()}`;

const asApp = <T>(ctx: Parameters<typeof withContext>[1], fn: (db: Db) => Promise<T>) => withContext(pools.app, ctx, fn);
const grant = (tenantId: string, workOrderId: string, tokenHash: string, createdBy: string, extra: object = {}) => ({
  tenantId, workOrderId, tokenHash, createdBy, expiresAt: new Date(Date.now() + 86_400_000), ...extra,
});

beforeAll(async () => {
  pools = await openPools();
  f = await resetAndSeed(pools.migrator);
  await withContext(pools.migrator, { tenantId: f.tenantA }, async (db) => {
    await db.insert(schema.customers).values({ id: ids.customerA, tenantId: f.tenantA, name: "C", phone: "85900000000" });
    await db.insert(schema.devices).values({ id: ids.deviceA, tenantId: f.tenantA, customerId: ids.customerA, category: "celular", brand: "M", model: "X" });
    for (const [id, protocol] of [[ids.orderA, "2026-000001"], [ids.orderA2, "2026-000002"]] as const) {
      await db.insert(schema.workOrders).values({ id, tenantId: f.tenantA, protocol, customerId: ids.customerA, deviceId: ids.deviceA, reportedDefect: "x", openedBy: f.userA });
    }
    await db.insert(schema.customerAccessGrants).values(grant(f.tenantA, ids.orderA, HASH_A, f.userA));
  });
  await withContext(pools.migrator, { tenantId: f.tenantB }, async (db) => {
    await db.insert(schema.customers).values({ id: ids.customerB, tenantId: f.tenantB, name: "CB", phone: "85900000001" });
    await db.insert(schema.devices).values({ id: ids.deviceB, tenantId: f.tenantB, customerId: ids.customerB, category: "celular", brand: "M", model: "X" });
    await db.insert(schema.workOrders).values({ id: ids.orderB, tenantId: f.tenantB, protocol: "2026-000001", customerId: ids.customerB, deviceId: ids.deviceB, reportedDefect: "x", openedBy: f.userB });
    await db.insert(schema.customerAccessGrants).values(grant(f.tenantB, ids.orderB, HASH_B, f.userB));
  });
});

afterAll(async () => {
  await pools.app.end();
  await pools.migrator.end();
});

describe("leitura do link do consumidor pela RLS", () => {
  it("sem contexto e sem hash: nada é visível", async () => {
    expect(await asApp({}, (db) => db.select().from(schema.customerAccessGrants))).toHaveLength(0);
  });

  it("sem contexto de empresa, só a linha cujo hash foi informado", async () => {
    const rows = await asApp({ grantHash: HASH_A }, (db) => db.select().from(schema.customerAccessGrants));
    expect(rows.map((r) => r.workOrderId)).toEqual([ids.orderA]);
    expect(await asApp({ grantHash: "hash-inexistente" }, (db) => db.select().from(schema.customerAccessGrants))).toHaveLength(0);
  });

  it("com o hash de A, nada de B aparece, e o hash vale só sem contexto de empresa", async () => {
    const rows = await asApp({ grantHash: HASH_A }, (db) => db.select().from(schema.customerAccessGrants));
    expect(rows.every((r) => r.tenantId === f.tenantA)).toBe(true);
    // Com contexto de B, o hash de A não abre nada de A.
    const mixed = await asApp({ tenantId: f.tenantB, grantHash: HASH_A }, (db) => db.select().from(schema.customerAccessGrants));
    expect(mixed.map((r) => r.tenantId)).toEqual([f.tenantB]);
  });

  it("enumerar a tabela não é possível: o link de B não aparece para A", async () => {
    const rows = await asApp({ tenantId: f.tenantA }, (db) => db.select().from(schema.customerAccessGrants));
    expect(rows.map((r) => r.tokenHash)).toEqual([HASH_A]);
  });
});

describe("imutabilidade e unicidade", () => {
  it("só a revogação pode ser alterada; token, validade e OS não", async () => {
    for (const column of ["token_hash = 'x'", "expires_at = now() + interval '1 year'", "created_by = created_by", "work_order_id = work_order_id"]) {
      expect(await sqlState(asApp({ tenantId: f.tenantA }, (db) => db.execute(sql.raw(`UPDATE customer_access_grants SET ${column}`)))), column).toBe("42501");
    }
    expect(await sqlState(asApp({ tenantId: f.tenantA }, (db) => db.execute(sql`DELETE FROM customer_access_grants`)))).toBe("42501");
  });

  it("um segundo link ativo na mesma OS é recusado; depois de revogar o anterior, é aceito", async () => {
    const second = grant(f.tenantA, ids.orderA, `hash-${randomUUID()}`, f.userA);
    expect(await sqlState(asApp({ tenantId: f.tenantA }, (db) => db.insert(schema.customerAccessGrants).values(second)))).toBe("23505");
    await asApp({ tenantId: f.tenantA }, (db) => db.update(schema.customerAccessGrants).set({ revokedAt: new Date() }).where(sql`token_hash = ${HASH_A}`));
    expect(await sqlState(asApp({ tenantId: f.tenantA }, (db) => db.insert(schema.customerAccessGrants).values(second)))).toBeUndefined();
  });

  it("não se cria link para OS de outra empresa, nem para outra empresa via contexto", async () => {
    expect(await sqlState(asApp({ tenantId: f.tenantA }, (db) => db.insert(schema.customerAccessGrants).values(grant(f.tenantA, ids.orderB, `h-${randomUUID()}`, f.userA))))).toBe("23503");
    expect(await sqlState(asApp({ tenantId: f.tenantA }, (db) => db.insert(schema.customerAccessGrants).values(grant(f.tenantB, ids.orderB, `h-${randomUUID()}`, f.userA))))).toBe("42501");
  });

  it("o hash do token é único no sistema", async () => {
    expect(await sqlState(asApp({ tenantId: f.tenantA }, (db) => db.insert(schema.customerAccessGrants).values(grant(f.tenantA, ids.orderA2, HASH_B, f.userA))))).toBe("23505");
  });
});
