import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema, withContext, type Db } from "../src/index.js";
import { openPools, resetAndSeed, sqlState, type Fixture, type Pools } from "./helpers.js";

let pools: Pools;
let f: Fixture;
const ids = {
  customerA: randomUUID(), deviceA: randomUUID(), orderA: randomUUID(), orderA2: randomUUID(),
  customerB: randomUUID(), deviceB: randomUUID(), orderB: randomUUID(), diagA: randomUUID(),
};

// O migrador também fica sob os gatilhos: provam que a barreira não está só no aplicativo.
const asMigratorA = <T>(fn: (db: Db) => Promise<T>) => withContext(pools.migrator, { tenantId: f.tenantA }, fn);
const asAppA = <T>(fn: (db: Db) => Promise<T>) => withContext(pools.app, { tenantId: f.tenantA }, fn);

const draft = (orderId: string, number: number, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), tenantId: f.tenantA, workOrderId: orderId, number, createdBy: f.userA, ...extra,
});
/** Versão enviada válida (satisfaz o CHECK de campos obrigatórios). */
const sentFields = () => ({
  state: "enviado", subtotalCents: 10000, discountCents: 1000, totalCents: 9000, paymentTerms: "À vista",
  estimatedDays: 3, validUntil: new Date(Date.now() + 86400000), basedOnDiagnosticId: ids.diagA,
  submittedBy: f.userA, submittedAt: new Date(),
});
const update = (id: string, set: Record<string, unknown>) => (db: Db) =>
  db.update(schema.quoteVersions).set(set).where(sql`id = ${id}`);

beforeAll(async () => {
  pools = await openPools();
  f = await resetAndSeed(pools.migrator);
  await asMigratorA(async (db) => {
    await db.insert(schema.customers).values({ id: ids.customerA, tenantId: f.tenantA, name: "C", phone: "85900000000" });
    await db.insert(schema.devices).values({ id: ids.deviceA, tenantId: f.tenantA, customerId: ids.customerA, category: "celular", brand: "M", model: "X" });
    for (const [id, protocol] of [[ids.orderA, "2026-000001"], [ids.orderA2, "2026-000002"]] as const) {
      await db.insert(schema.workOrders).values({
        id, tenantId: f.tenantA, protocol, customerId: ids.customerA, deviceId: ids.deviceA, reportedDefect: "Não liga", openedBy: f.userA,
      });
    }
    await db.insert(schema.diagnostics).values({
      id: ids.diagA, tenantId: f.tenantA, workOrderId: ids.orderA, revision: 1, nature: "confirmado",
      symptoms: "s", checksPerformed: "c", findings: "Bateria", authorId: f.userA,
    });
  });
  await withContext(pools.migrator, { tenantId: f.tenantB }, async (db) => {
    await db.insert(schema.customers).values({ id: ids.customerB, tenantId: f.tenantB, name: "CB", phone: "85900000001" });
    await db.insert(schema.devices).values({ id: ids.deviceB, tenantId: f.tenantB, customerId: ids.customerB, category: "celular", brand: "M", model: "X" });
    await db.insert(schema.workOrders).values({
      id: ids.orderB, tenantId: f.tenantB, protocol: "2026-000001", customerId: ids.customerB, deviceId: ids.deviceB, reportedDefect: "x", openedBy: f.userB,
    });
  });
});

afterAll(async () => {
  await pools.app.end();
  await pools.migrator.end();
});

describe("CHECKs de orçamento e diagnóstico", () => {
  it("total tem de ser subtotal - desconto, e o desconto não passa do subtotal", async () => {
    const insert = (values: Record<string, unknown>) =>
      sqlState(asMigratorA((db) => db.insert(schema.quoteVersions).values(draft(ids.orderA2, 90, values))));
    expect(await insert({ subtotalCents: 1000, discountCents: 0, totalCents: 999 })).toBe("23514");
    expect(await insert({ subtotalCents: 1000, discountCents: 1001, totalCents: -1 })).toBe("23514");
    expect(await insert({ subtotalCents: -5, totalCents: -5 })).toBe("23514");
  });

  it("estado inválido e envio sem prazo/condições/base são recusados", async () => {
    const insert = (values: Record<string, unknown>) =>
      sqlState(asMigratorA((db) => db.insert(schema.quoteVersions).values(draft(ids.orderA2, 91, values))));
    expect(await insert({ state: "aprovadinho" })).toBe("23514");
    expect(await insert({ state: "enviado" })).toBe("23514");
  });

  it("item com quantidade zero ou preço negativo é recusado", async () => {
    const quote = draft(ids.orderA2, 92);
    await asMigratorA((db) => db.insert(schema.quoteVersions).values(quote));
    const item = (extra: Record<string, unknown>) => ({
      tenantId: f.tenantA, quoteVersionId: quote.id, position: 1, kind: "servico", description: "x", quantity: 1, unitPriceCents: 100, ...extra,
    });
    expect(await sqlState(asMigratorA((db) => db.insert(schema.quoteItems).values(item({ quantity: 0 }))))).toBe("23514");
    expect(await sqlState(asMigratorA((db) => db.insert(schema.quoteItems).values(item({ unitPriceCents: -1 }))))).toBe("23514");
    expect(await sqlState(asMigratorA((db) => db.insert(schema.quoteItems).values(item({ kind: "brinde" }))))).toBe("23514");
    await asMigratorA((db) => db.delete(schema.quoteVersions).where(sql`id = ${quote.id}`));
  });

  it("diagnóstico de suspeita/confirmado exige o defeito identificado; inconclusivo pode omitir", async () => {
    const diag = (extra: Record<string, unknown>, revision: number) => ({
      tenantId: f.tenantA, workOrderId: ids.orderA2, revision, nature: "suspeita", symptoms: "s", checksPerformed: "c", authorId: f.userA, ...extra,
    });
    expect(await sqlState(asMigratorA((db) => db.insert(schema.diagnostics).values(diag({}, 1))))).toBe("23514");
    expect(await sqlState(asMigratorA((db) => db.insert(schema.diagnostics).values(diag({ nature: "inconclusivo" }, 1))))).toBeUndefined();
    expect(await sqlState(asMigratorA((db) => db.insert(schema.diagnostics).values(diag({ nature: "quase" , findings: "x" }, 2))))).toBe("23514");
  });
});

describe("imutabilidade do orçamento enviado (gatilhos)", () => {
  it("rascunho muda à vontade; depois de enviado, conteúdo congela mesmo para o migrador", async () => {
    const quote = draft(ids.orderA, 1);
    await asMigratorA((db) => db.insert(schema.quoteVersions).values(quote));
    await asMigratorA((db) => db.insert(schema.quoteItems).values({ tenantId: f.tenantA, quoteVersionId: quote.id, position: 1, kind: "peca", description: "Bateria", quantity: 1, unitPriceCents: 10000 }));
    expect(await sqlState(asMigratorA(update(quote.id, { notes: "ajuste no rascunho" })))).toBeUndefined();
    expect(await sqlState(asMigratorA(update(quote.id, sentFields())))).toBeUndefined();

    for (const tamper of [{ totalCents: 1, subtotalCents: 1, discountCents: 0 }, { discountCents: 0, totalCents: 10000 }, { notes: "troca" }, { paymentTerms: "Fiado" }, { validUntil: new Date(Date.now() + 9e9) }, { estimatedDays: 99 }, { number: 7 }]) {
      expect(await sqlState(asMigratorA(update(quote.id, tamper))), JSON.stringify(tamper)).toBe("55000");
    }
    // revision e updated_at são metadados e podem mudar.
    expect(await sqlState(asMigratorA(update(quote.id, { revision: 9 })))).toBeUndefined();
  });

  it("itens de versão enviada não podem ser inseridos, alterados nem removidos", async () => {
    const sent = await asMigratorA(async (db) => (await db.select().from(schema.quoteVersions).where(sql`number = 1 and work_order_id = ${ids.orderA}`))[0]);
    expect(sent?.state).toBe("enviado");
    const newItem = { tenantId: f.tenantA, quoteVersionId: sent?.id ?? "", position: 9, kind: "servico", description: "Extra", quantity: 1, unitPriceCents: 1 };
    expect(await sqlState(asMigratorA((db) => db.insert(schema.quoteItems).values(newItem)))).toBe("55000");
    expect(await sqlState(asMigratorA((db) => db.update(schema.quoteItems).set({ unitPriceCents: 1 }).where(sql`quote_version_id = ${sent?.id}`)))).toBe("55000");
    expect(await sqlState(asMigratorA((db) => db.delete(schema.quoteItems).where(sql`quote_version_id = ${sent?.id}`)))).toBe("55000");
    expect(await sqlState(asAppA((db) => db.delete(schema.quoteItems).where(sql`quote_version_id = ${sent?.id}`)))).toBe("55000");
  });

  it("falha fechada: sem contexto de empresa a aplicação não enxerga nem apaga itens", async () => {
    const sent = await asMigratorA(async (db) => (await db.select().from(schema.quoteVersions).where(sql`number = 1 and work_order_id = ${ids.orderA}`))[0]);
    const before = await asMigratorA((db) => db.select().from(schema.quoteItems).where(sql`quote_version_id = ${sent?.id}`));
    expect(before.length).toBeGreaterThan(0);
    // A RLS filtra tudo: o DELETE não alcança nenhuma linha (nada muda) e o INSERT é recusado.
    await withContext(pools.app, {}, (db) => db.execute(sql`DELETE FROM quote_items WHERE quote_version_id = ${sent?.id}`));
    const insertState = await sqlState(withContext(pools.app, {}, (db) =>
      db.insert(schema.quoteItems).values({ tenantId: f.tenantA, quoteVersionId: sent?.id ?? "", position: 8, kind: "peca", description: "x", quantity: 1, unitPriceCents: 1 })));
    expect(insertState).toBeDefined();
    const after = await asMigratorA((db) => db.select().from(schema.quoteItems).where(sql`quote_version_id = ${sent?.id}`));
    expect(after).toHaveLength(before.length);
  });

  it("transições de estado: só enviado -> aprovado|recusado|expirado|substituido; nada volta", async () => {
    const quote = draft(ids.orderA2, 10);
    await asMigratorA((db) => db.insert(schema.quoteVersions).values(quote));
    expect(await sqlState(asMigratorA(update(quote.id, { state: "aprovado" })))).toBe("55000"); // rascunho não pula o envio
    expect(await sqlState(asMigratorA(update(quote.id, sentFields())))).toBeUndefined();
    expect(await sqlState(asMigratorA(update(quote.id, { state: "rascunho" })))).toBe("55000");
    expect(await sqlState(asMigratorA(update(quote.id, { state: "aprovado", decidedAt: new Date() })))).toBeUndefined();
    for (const back of ["enviado", "rascunho", "recusado", "expirado", "substituido"]) {
      expect(await sqlState(asMigratorA(update(quote.id, { state: back }))), back).toBe("55000");
    }
  });

  it("versão enviada não pode ser removida; rascunho pode", async () => {
    const sent = await asMigratorA(async (db) => (await db.select().from(schema.quoteVersions).where(sql`number = 10`))[0]);
    expect(await sqlState(asMigratorA((db) => db.delete(schema.quoteVersions).where(sql`id = ${sent?.id}`)))).toBe("55000");
  });
});

describe("uma versão aberta por OS e decisões", () => {
  it("segundo rascunho/enviado na mesma OS é recusado; liberado depois de substituir", async () => {
    const first = draft(ids.orderA2, 20);
    await asMigratorA((db) => db.insert(schema.quoteVersions).values(first));
    expect(await sqlState(asMigratorA((db) => db.insert(schema.quoteVersions).values(draft(ids.orderA2, 21))))).toBe("23505");
    await asMigratorA(update(first.id, sentFields()));
    expect(await sqlState(asMigratorA((db) => db.insert(schema.quoteVersions).values(draft(ids.orderA2, 21))))).toBe("23505");
    await asMigratorA(update(first.id, { state: "substituido" }));
    expect(await sqlState(asMigratorA((db) => db.insert(schema.quoteVersions).values(draft(ids.orderA2, 21))))).toBeUndefined();
  });

  it("número de versão é único por OS", async () => {
    expect(await sqlState(asMigratorA((db) => db.insert(schema.quoteVersions).values(draft(ids.orderA2, 20))))).toBe("23505");
  });

  it("uma decisão por versão; canal e decisão limitados; decisão é append-only para a aplicação", async () => {
    // OS própria: as outras já têm uma versão aberta (índice parcial).
    const ownOrder = randomUUID();
    await asMigratorA((db) => db.insert(schema.workOrders).values({
      id: ownOrder, tenantId: f.tenantA, protocol: "2026-000099", customerId: ids.customerA, deviceId: ids.deviceA, reportedDefect: "x", openedBy: f.userA,
    }));
    const quote = draft(ownOrder, 1);
    await asMigratorA((db) => db.insert(schema.quoteVersions).values(quote));
    await asMigratorA(update(quote.id, sentFields()));
    const decision = (extra: Record<string, unknown> = {}) => ({
      tenantId: f.tenantA, quoteVersionId: quote.id, decision: "aprovado", channel: "presencial", decidedBy: f.userA, confirmedByName: "Maria", ...extra,
    });
    expect(await sqlState(asAppA((db) => db.insert(schema.quoteDecisions).values(decision())))).toBeUndefined();
    expect(await sqlState(asAppA((db) => db.insert(schema.quoteDecisions).values(decision({ decision: "recusado" }))))).toBe("23505");
    expect(await sqlState(asAppA((db) => db.insert(schema.quoteDecisions).values(decision({ decision: "talvez" }))))).toBe("23514");
    expect(await sqlState(asAppA((db) => db.execute(sql`UPDATE quote_decisions SET decision = 'recusado'`)))).toBe("42501");
    expect(await sqlState(asAppA((db) => db.execute(sql`DELETE FROM quote_decisions`)))).toBe("42501");
  });

  it("diagnóstico não pode ser alterado nem apagado pela aplicação", async () => {
    expect(await sqlState(asAppA((db) => db.execute(sql`UPDATE diagnostics SET findings = 'x'`)))).toBe("42501");
    expect(await sqlState(asAppA((db) => db.execute(sql`DELETE FROM diagnostics`)))).toBe("42501");
  });
});

describe("eventos de sistema e isolamento", () => {
  it("evento sem ator só é aceito para a expiração automática", async () => {
    const event = (type: string) => ({ tenantId: f.tenantA, workOrderId: ids.orderA, type });
    expect(await sqlState(asAppA((db) => db.insert(schema.workOrderEvents).values(event("orcamento_expirado"))))).toBeUndefined();
    expect(await sqlState(asAppA((db) => db.insert(schema.workOrderEvents).values(event("os_cancelada"))))).toBe("23514");
  });

  it("A não vê nem liga orçamento/diagnóstico de B; FK composta impede vínculo cruzado", async () => {
    expect(await sqlState(asMigratorA((db) => db.insert(schema.quoteVersions).values(draft(ids.orderB, 1))))).toBe("23503");
    expect(await sqlState(asMigratorA((db) => db.insert(schema.diagnostics).values({
      tenantId: f.tenantA, workOrderId: ids.orderB, revision: 1, nature: "confirmado", symptoms: "s", checksPerformed: "c", findings: "f", authorId: f.userA,
    })))).toBe("23503");
    const seenByB = await withContext(pools.app, { tenantId: f.tenantB }, async (db) => ({
      quotes: await db.select().from(schema.quoteVersions),
      diags: await db.select().from(schema.diagnostics),
      decisions: await db.select().from(schema.quoteDecisions),
    }));
    expect(seenByB.quotes).toHaveLength(0);
    expect(seenByB.diags).toHaveLength(0);
    expect(seenByB.decisions).toHaveLength(0);
  });
});
