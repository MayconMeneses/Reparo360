import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withContext, type Db } from "../src/index.js";
import { openPools, resetAndSeed, sqlState, type Fixture, type Pools } from "./helpers.js";

let pools: Pools;
let f: Fixture;
const ids = {
  customerA: randomUUID(), deviceA: randomUUID(), orderA: randomUUID(), orderA2: randomUUID(),
  customerB: randomUUID(), deviceB: randomUUID(), orderB: randomUUID(),
};

const asMigratorA = <T>(fn: (db: Db) => Promise<T>) => withContext(pools.migrator, { tenantId: f.tenantA }, fn);
const asAppA = <T>(fn: (db: Db) => Promise<T>) => withContext(pools.app, { tenantId: f.tenantA }, fn);

const order = (tenantId: string, customerId: string, deviceId: string, id: string, protocol: string, userId: string, extra: object = {}) => ({
  id, tenantId, customerId, deviceId, protocol, openedBy: userId, reportedDefect: "x", ...extra,
});
const repair = (extra: object = {}) => ({
  tenantId: f.tenantA, workOrderId: ids.orderA, cycle: 1, procedure: "Troca de bateria", outcome: "concluido", authorId: f.userA, ...extra,
});
const check = (extra: object = {}) => ({
  tenantId: f.tenantA, workOrderId: ids.orderA, cycle: 1, round: 1, item: "Carga", result: "aprovado", recordedBy: f.userA, ...extra,
});
const delivery = (workOrderId: string, extra: object = {}) => ({
  tenantId: f.tenantA, workOrderId, deliveredBy: f.userA, pickedUpByName: "Maria", confirmationMethod: "comprovante_apresentado", itemsReturned: ["carregador"], ...extra,
});

beforeAll(async () => {
  pools = await openPools();
  f = await resetAndSeed(pools.migrator);
  await asMigratorA(async (db) => {
    await db.insert(schema.customers).values({ id: ids.customerA, tenantId: f.tenantA, name: "C", phone: "85900000000" });
    await db.insert(schema.devices).values({ id: ids.deviceA, tenantId: f.tenantA, customerId: ids.customerA, category: "celular", brand: "M", model: "X" });
    await db.insert(schema.workOrders).values(order(f.tenantA, ids.customerA, ids.deviceA, ids.orderA, "2026-000001", f.userA));
    await db.insert(schema.workOrders).values(order(f.tenantA, ids.customerA, ids.deviceA, ids.orderA2, "2026-000002", f.userA));
  });
  await withContext(pools.migrator, { tenantId: f.tenantB }, async (db) => {
    await db.insert(schema.customers).values({ id: ids.customerB, tenantId: f.tenantB, name: "CB", phone: "85900000001" });
    await db.insert(schema.devices).values({ id: ids.deviceB, tenantId: f.tenantB, customerId: ids.customerB, category: "celular", brand: "M", model: "X" });
    await db.insert(schema.workOrders).values(order(f.tenantB, ids.customerB, ids.deviceB, ids.orderB, "2026-000001", f.userB));
  });
});

afterAll(async () => {
  await pools.app.end();
  await pools.migrator.end();
});

describe("reparo, testes e entrega: valores e vínculos", () => {
  it("resultado, desfecho, método e ciclo inválidos são recusados", async () => {
    expect(await sqlState(asMigratorA((db) => db.insert(schema.repairTasks).values(repair({ outcome: "talvez" }))))).toBe("23514");
    expect(await sqlState(asMigratorA((db) => db.insert(schema.repairTasks).values(repair({ cycle: 0 }))))).toBe("23514");
    expect(await sqlState(asMigratorA((db) => db.insert(schema.testChecks).values(check({ result: "ok" }))))).toBe("23514");
    expect(await sqlState(asMigratorA((db) => db.insert(schema.testChecks).values(check({ round: 0 }))))).toBe("23514");
    expect(await sqlState(asMigratorA((db) => db.insert(schema.deliveries).values(delivery(ids.orderA, { confirmationMethod: "digital" }))))).toBe("23514");
  });

  it("item repetido na mesma rodada é recusado; em outra rodada é aceito", async () => {
    expect(await sqlState(asMigratorA((db) => db.insert(schema.testChecks).values(check())))).toBeUndefined();
    expect(await sqlState(asMigratorA((db) => db.insert(schema.testChecks).values(check())))).toBe("23505");
    expect(await sqlState(asMigratorA((db) => db.insert(schema.testChecks).values(check({ round: 2 }))))).toBeUndefined();
  });

  it("uma entrega por OS", async () => {
    expect(await sqlState(asAppA((db) => db.insert(schema.deliveries).values(delivery(ids.orderA))))).toBeUndefined();
    expect(await sqlState(asAppA((db) => db.insert(schema.deliveries).values(delivery(ids.orderA, { pickedUpByName: "Outra pessoa" }))))).toBe("23505");
  });

  it("FK composta: nada de A aponta para a OS de B", async () => {
    expect(await sqlState(asMigratorA((db) => db.insert(schema.repairTasks).values(repair({ workOrderId: ids.orderB }))))).toBe("23503");
    expect(await sqlState(asMigratorA((db) => db.insert(schema.testChecks).values(check({ workOrderId: ids.orderB, item: "X" }))))).toBe("23503");
    expect(await sqlState(asMigratorA((db) => db.insert(schema.deliveries).values(delivery(ids.orderB))))).toBe("23503");
  });
});

describe("OS de retorno (origem)", () => {
  it("aponta para OS da mesma empresa, nunca para si mesma nem para a de outra empresa", async () => {
    const link = (originId: string, id = ids.orderA2) => asMigratorA((db) => db.update(schema.workOrders).set({ originWorkOrderId: originId }).where(sql`id = ${id}`));
    expect(await sqlState(link(ids.orderB))).toBe("23503");
    expect(await sqlState(link(ids.orderA2))).toBe("23514");
    expect(await sqlState(link(ids.orderA))).toBeUndefined();
  });
});

describe("append-only e isolamento", () => {
  it("a aplicação não altera nem apaga reparos, testes e entregas (42501)", async () => {
    for (const table of ["repair_tasks", "test_checks", "deliveries"]) {
      expect(await sqlState(asAppA((db) => db.execute(sql.raw(`UPDATE ${table} SET tenant_id = tenant_id`)))), `${table} update`).toBe("42501");
      expect(await sqlState(asAppA((db) => db.execute(sql.raw(`DELETE FROM ${table}`)))), `${table} delete`).toBe("42501");
    }
  });

  it("B não enxerga registros de A", async () => {
    await asMigratorA((db) => db.insert(schema.repairTasks).values(repair()));
    const seen = await withContext(pools.app, { tenantId: f.tenantB }, async (db) => ({
      repairs: await db.select().from(schema.repairTasks),
      checks: await db.select().from(schema.testChecks),
      deliveries: await db.select().from(schema.deliveries),
    }));
    expect(seen.repairs).toHaveLength(0);
    expect(seen.checks).toHaveLength(0);
    expect(seen.deliveries).toHaveLength(0);
    const mine = await asAppA((db) => db.select().from(schema.repairTasks));
    expect(mine.length).toBeGreaterThan(0);
  });
});
