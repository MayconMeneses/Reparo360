import { randomUUID } from "node:crypto";
import { schema, withContext } from "@reparo360/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addMember, call, loginOk, onboard, resetData, setupOrder, startTestEnv, type Account, type Session, type TestEnv } from "./helpers.js";

let env: TestEnv;
let a: Account;
let ownerA: Session;
let ownerB: Session;

beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetData(env.migrator);
  a = await onboard(env, "auditA");
  const b = await onboard(env, "auditB");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

type Event = { id: string; at: string; action: string; outcome: string; targetType: string | null; targetId: string | null; reason: string | null; actor: { kind: string; name: string | null } };
const list = async (session: Session, query = "") => {
  const res = await call(env, session, "GET", `/audit${query}`);
  return { res, body: res.statusCode === 200 ? res.json<{ events: Event[]; hasMore: boolean }>() : null };
};

describe("auditoria consultável (RF-023)", () => {
  it("proprietário e gerente consultam; atendente, técnico e anônimo não", async () => {
    const manager = await loginOk(env, (await addMember(env, ownerA, "gerente")).email);
    expect((await list(ownerA)).res.statusCode).toBe(200);
    expect((await list(manager)).res.statusCode).toBe(200);
    for (const role of ["atendente", "tecnico"]) {
      const session = await loginOk(env, (await addMember(env, ownerA, role)).email);
      expect((await list(session)).res.statusCode, role).toBe(403);
    }
    expect((await call(env, null, "GET", "/audit")).statusCode).toBe(401);
  });

  it("mostra o que aconteceu, do mais novo para o mais antigo, com o nome de quem agiu", async () => {
    await addMember(env, ownerA, "atendente");
    await setupOrder(env, ownerA);
    const { body } = await list(ownerA);
    const actions = body!.events.map((e) => e.action);
    expect(actions).toContain("team_member_created");
    expect(actions).toContain("work_order_opened");
    expect(actions).toContain("login");
    const times = body!.events.map((e) => new Date(e.at).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    const opened = body!.events.find((e) => e.action === "work_order_opened")!;
    expect(opened.actor.kind).toBe("equipe");
    expect(opened.actor.name).toBeTruthy();
    expect(opened.targetType).toBe("work_order");
  });

  it("nunca devolve IP, ID de correlação, ID do ator nem segredos", async () => {
    await setupOrder(env, ownerA);
    const { res, body } = await list(ownerA);
    for (const event of body!.events) expect(Object.keys(event).sort()).toEqual(["action", "actor", "at", "id", "outcome", "reason", "targetId", "targetType"]);
    expect(res.body).not.toMatch(/127\.0\.0\.1|correlation|actor_?user|argon2|token|hash/i);
  });

  it("uma assistência nunca vê os eventos da outra", async () => {
    await setupOrder(env, ownerB);
    const { body } = await list(ownerA);
    expect(body!.events.every((e) => e.action !== "work_order_opened")).toBe(true);
    const other = await list(ownerB);
    expect(other.body!.events.some((e) => e.action === "work_order_opened")).toBe(true);
  });

  it("ações da plataforma e do consumidor aparecem com a origem certa e sem inventar nome", async () => {
    await withContext(env.migrator, { tenantId: a.tenantId }, async (db) => {
      await db.insert(schema.auditEvents).values([
        { tenantId: a.tenantId, actorUserId: randomUUID(), action: "master_tenant_suspensa", targetType: "tenant", targetId: a.tenantId, outcome: "ok", reason: "Pedido formal do dono" },
        { tenantId: a.tenantId, action: "quote_aprovado_remoto", targetType: "quote", targetId: randomUUID(), outcome: "ok" },
        { tenantId: a.tenantId, action: "work_order_expired_sweep", outcome: "ok" },
      ]);
    });
    const { body } = await list(ownerA);
    const byAction = Object.fromEntries(body!.events.map((e) => [e.action, e]));
    expect(byAction["master_tenant_suspensa"]).toMatchObject({ actor: { kind: "plataforma", name: null }, reason: "Pedido formal do dono" });
    expect(byAction["quote_aprovado_remoto"]?.actor).toEqual({ kind: "cliente", name: null });
    expect(byAction["work_order_expired_sweep"]?.actor).toEqual({ kind: "sistema", name: null });
  });

  it("filtra por ação, por resultado e por período; período inválido é recusado", async () => {
    await setupOrder(env, ownerA);
    await call(env, ownerA, "POST", "/auth/reauth", { password: "senha-errada-123456" });
    expect((await list(ownerA, "?action=work_order_opened")).body!.events.every((e) => e.action === "work_order_opened")).toBe(true);
    const denied = (await list(ownerA, "?outcome=negado")).body!.events;
    expect(denied.length).toBeGreaterThan(0);
    expect(denied.every((e) => e.outcome === "negado")).toBe(true);
    // Dia de São Paulo (UTC-03:00 fixo, como a API): em UTC, depois das 21h de Brasília o "hoje" já seria o dia seguinte.
    const day = (offset: number) => new Date(Date.now() - 3 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
    expect((await list(ownerA, `?from=${day(0)}&to=${day(0)}`)).body!.events.length).toBeGreaterThan(0);
    expect((await list(ownerA, `?from=${day(1)}&to=${day(2)}`)).body!.events).toEqual([]);
    expect((await list(ownerA, `?from=${day(-3)}&to=${day(-2)}`)).body!.events).toEqual([]);
    for (const bad of ["?from=2026-02-30x", `?from=${day(5)}&to=${day(0)}`, "?from=2020-01-01&to=2026-12-31", "?action=Drop;Table", "?limit=0", "?limit=51", "?extra=1"]) {
      expect((await list(ownerA, bad)).res.statusCode, bad).toBe(400);
    }
  });

  it("pagina com ordem estável e diz se há mais", async () => {
    await setupOrder(env, ownerA);
    await setupOrder(env, ownerA);
    const all = (await list(ownerA, "?limit=50")).body!;
    expect(all.hasMore).toBe(false);
    const first = (await list(ownerA, "?limit=2&offset=0")).body!;
    const second = (await list(ownerA, "?limit=2&offset=2")).body!;
    expect(first.events).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect([...first.events, ...second.events].map((e) => e.id)).toEqual(all.events.slice(0, 4).map((e) => e.id));
  });

  it("a consulta de auditoria não deixa rastro de escrita: a tabela continua só de inclusão", async () => {
    const before = (await list(ownerA)).body!.events.length;
    await list(ownerA);
    await expect(env.pool.query("UPDATE audit_events SET action = 'x'")).rejects.toMatchObject({ code: "42501" });
    await expect(env.pool.query("DELETE FROM audit_events")).rejects.toMatchObject({ code: "42501" });
    expect((await list(ownerA)).body!.events.length).toBe(before);
  });
});
