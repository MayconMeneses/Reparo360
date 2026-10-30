import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withContext, type Db } from "../src/index.js";
import { openPools, resetAndSeed, type Fixture, type Pools } from "./helpers.js";

let pools: Pools;
let f: Fixture;
const ids = {
  customerA: randomUUID(),
  customerA2: randomUUID(),
  customerB: randomUUID(),
  deviceA: randomUUID(),
  deviceA2: randomUUID(),
  deviceB: randomUUID(),
  orderA: randomUUID(),
  orderB: randomUUID(),
  attachmentA: randomUUID(),
};

/** Código SQLSTATE do erro do PostgreSQL (o Drizzle o embrulha em `cause`). */
async function sqlState(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
}

const customer = (tenantId: string, id: string) => ({ id, tenantId, name: "Cliente Sintético", phone: "85999990000" });
const device = (tenantId: string, customerId: string, id: string) => ({
  id, tenantId, customerId, category: "celular", brand: "Marca", model: "Modelo",
});
const order = (tenantId: string, customerId: string, deviceId: string, id: string, protocol: string, openedBy: string) => ({
  id, tenantId, customerId, deviceId, protocol, openedBy, reportedDefect: "Não liga",
});

beforeAll(async () => {
  pools = await openPools();
  f = await resetAndSeed(pools.migrator);
  const seed = (tenantId: string, fn: (db: Db) => Promise<unknown>) => withContext(pools.migrator, { tenantId }, fn);
  await seed(f.tenantA, async (db) => {
    await db.insert(schema.customers).values([customer(f.tenantA, ids.customerA), customer(f.tenantA, ids.customerA2)]);
    await db.insert(schema.devices).values([device(f.tenantA, ids.customerA, ids.deviceA), device(f.tenantA, ids.customerA2, ids.deviceA2)]);
    await db.insert(schema.workOrders).values(order(f.tenantA, ids.customerA, ids.deviceA, ids.orderA, "2026-000001", f.userA));
    await db.insert(schema.workOrderEvents).values({ tenantId: f.tenantA, workOrderId: ids.orderA, type: "os_aberta", actorUserId: f.userA });
    await db.insert(schema.attachments).values({
      id: ids.attachmentA, tenantId: f.tenantA, workOrderId: ids.orderA, storageKey: `k-${randomUUID()}`,
      contentType: "image/png", sizeBytes: 10, sha256: "a".repeat(64), uploadedBy: f.userA,
    });
  });
  await seed(f.tenantB, async (db) => {
    await db.insert(schema.customers).values(customer(f.tenantB, ids.customerB));
    await db.insert(schema.devices).values(device(f.tenantB, ids.customerB, ids.deviceB));
    await db.insert(schema.workOrders).values(order(f.tenantB, ids.customerB, ids.deviceB, ids.orderB, "2026-000001", f.userB));
  });
});

afterAll(async () => {
  await pools.app.end();
  await pools.migrator.end();
});

describe("FKs compostas: o banco recusa vínculo entre empresas e entre clientes", () => {
  it("equipamento de A não pode apontar para cliente de B", async () => {
    const state = await sqlState(withContext(pools.migrator, { tenantId: f.tenantA }, (db) =>
      db.insert(schema.devices).values(device(f.tenantA, ids.customerB, randomUUID()))));
    expect(state).toBe("23503");
  });

  it("OS de A não pode apontar para equipamento de B", async () => {
    const state = await sqlState(withContext(pools.migrator, { tenantId: f.tenantA }, (db) =>
      db.insert(schema.workOrders).values(order(f.tenantA, ids.customerA, ids.deviceB, randomUUID(), "2026-000002", f.userA))));
    expect(state).toBe("23503");
  });

  it("OS não pode combinar um cliente com o equipamento de outro cliente da mesma empresa", async () => {
    const state = await sqlState(withContext(pools.migrator, { tenantId: f.tenantA }, (db) =>
      db.insert(schema.workOrders).values(order(f.tenantA, ids.customerA, ids.deviceA2, randomUUID(), "2026-000003", f.userA))));
    expect(state).toBe("23503");
  });

  it("técnico precisa ser membro da mesma empresa", async () => {
    const state = await sqlState(withContext(pools.migrator, { tenantId: f.tenantA }, (db) =>
      db.insert(schema.workOrders).values({ ...order(f.tenantA, ids.customerA, ids.deviceA, randomUUID(), "2026-000004", f.userA), technicianId: f.userB })));
    expect(state).toBe("23503");
  });

  it("protocolo é único dentro da empresa, mas pode se repetir entre empresas", async () => {
    const state = await sqlState(withContext(pools.migrator, { tenantId: f.tenantA }, (db) =>
      db.insert(schema.workOrders).values(order(f.tenantA, ids.customerA, ids.deviceA, randomUUID(), "2026-000001", f.userA))));
    expect(state).toBe("23505");
    // O seed já criou "2026-000001" em A e em B sem conflito.
  });
});

describe("CHECKs de domínio", () => {
  it("estado, prioridade, categoria e IMEI inválidos são recusados", async () => {
    const run = (values: Record<string, unknown>) =>
      sqlState(withContext(pools.migrator, { tenantId: f.tenantA }, (db) => db.execute(sql`SELECT 1`).then(() => db.update(schema.workOrders).set(values).where(sql`id = ${ids.orderA}`))));
    expect(await run({ state: "QUALQUER" })).toBe("23514");
    expect(await run({ priority: "máxima" })).toBe("23514");
    const category = await sqlState(withContext(pools.migrator, { tenantId: f.tenantA }, (db) =>
      db.update(schema.devices).set({ category: "geladeira" }).where(sql`id = ${ids.deviceA}`)));
    expect(category).toBe("23514");
    const imei = await sqlState(withContext(pools.migrator, { tenantId: f.tenantA }, (db) =>
      db.update(schema.devices).set({ imei: "123" }).where(sql`id = ${ids.deviceA}`)));
    expect(imei).toBe("23514");
  });

  it("papel e status de vínculo inválidos (Fase 1) são recusados", async () => {
    const role = await sqlState(withContext(pools.migrator, { tenantId: f.tenantA }, (db) =>
      db.update(schema.memberships).set({ role: "admin" }).where(sql`user_id = ${f.userA}`)));
    expect(role).toBe("23514");
  });
});

describe("imutabilidade e privilégios mínimos (papel da aplicação)", () => {
  const asApp = (fn: (db: Db) => Promise<unknown>) => sqlState(withContext(pools.app, { tenantId: f.tenantA }, fn));

  it("eventos da OS não aceitam UPDATE nem DELETE", async () => {
    expect(await asApp((db) => db.execute(sql`UPDATE work_order_events SET type = 'x'`))).toBe("42501");
    expect(await asApp((db) => db.execute(sql`DELETE FROM work_order_events`))).toBe("42501");
  });

  it("recebimento é imutável", async () => {
    expect(await asApp((db) => db.execute(sql`UPDATE intake_inspections SET physical_condition = 'x'`))).toBe("42501");
    expect(await asApp((db) => db.execute(sql`DELETE FROM intake_inspections`))).toBe("42501");
  });

  it("anexo: só a exclusão lógica é permitida; trocar tipo, chave ou tamanho não", async () => {
    expect(await asApp((db) => db.execute(sql`UPDATE attachments SET content_type = 'application/pdf'`))).toBe("42501");
    expect(await asApp((db) => db.execute(sql`UPDATE attachments SET storage_key = 'outra'`))).toBe("42501");
    expect(await asApp((db) => db.execute(sql`DELETE FROM attachments`))).toBe("42501");
    expect(await asApp((db) => db.execute(sql`UPDATE attachments SET deleted_at = now(), deleted_by = ${f.userA}`))).toBeUndefined();
  });
});

describe("RLS nas tabelas novas", () => {
  it("A não enxerga clientes, equipamentos, OS, eventos nem anexos de B (e vice-versa)", async () => {
    const seenByA = await withContext(pools.app, { tenantId: f.tenantA }, async (db) => ({
      customers: (await db.select().from(schema.customers)).map((r) => r.id),
      devices: (await db.select().from(schema.devices)).map((r) => r.id),
      orders: (await db.select().from(schema.workOrders)).map((r) => r.id),
    }));
    expect(seenByA.customers).not.toContain(ids.customerB);
    expect(seenByA.devices).not.toContain(ids.deviceB);
    expect(seenByA.orders).toEqual([ids.orderA]);
    const seenByB = await withContext(pools.app, { tenantId: f.tenantB }, async (db) => ({
      orders: (await db.select().from(schema.workOrders)).map((r) => r.id),
      attachments: await db.select().from(schema.attachments),
      events: await db.select().from(schema.workOrderEvents),
    }));
    expect(seenByB.orders).toEqual([ids.orderB]);
    expect(seenByB.attachments).toHaveLength(0);
    expect(seenByB.events).toHaveLength(0);
  });

  it("sem contexto, nada das tabelas novas é visível", async () => {
    expect(await withContext(pools.app, {}, (db) => db.select().from(schema.customers))).toHaveLength(0);
    expect(await withContext(pools.app, {}, (db) => db.select().from(schema.workOrders))).toHaveLength(0);
  });

  it("A não consegue gravar OS com tenant_id de B", async () => {
    const state = await sqlState(withContext(pools.app, { tenantId: f.tenantA }, (db) =>
      db.insert(schema.workOrders).values(order(f.tenantB, ids.customerB, ids.deviceB, randomUUID(), "2026-000009", f.userA))));
    expect(state).toBe("42501");
  });
});
