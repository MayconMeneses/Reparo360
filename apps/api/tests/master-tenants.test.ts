import { schema, withContext } from "@reparo360/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, loginOk, newCustomer, newDevice, onboard, resetData, startTestEnv, type Account, type TestEnv } from "./helpers.js";
import {
  codeFor, getWith, MASTER_KEY_HEX, masterLogin, postJson, seedMaster, type MasterSession, type TestMaster,
} from "./master-helpers.js";

let env: TestEnv;
let now: Date;
let master: TestMaster;
let session: MasterSession;
let a: Account;
let b: Account;

beforeAll(async () => {
  env = await startTestEnv({ MASTER_ENC_KEY: MASTER_KEY_HEX, LOGIN_ACCOUNT_MAX_FAILURES: "1000" }, () => now);
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  now = new Date("2026-11-10T12:00:00Z");
  await resetData(env.migrator);
  await env.migrator.query("TRUNCATE platform_sessions, platform_challenges, platform_admins CASCADE");
  master = await seedMaster(env);
  a = await onboard(env, "empresaA");
  b = await onboard(env, "empresaB");
  session = await masterLogin(env, master, now);
});

const statusOf = async (tenantId: string) =>
  (await withContext(env.migrator, { tenantId }, (db) => db.select({ status: schema.tenants.status }).from(schema.tenants)))[0]?.status;

const setStatus = (tenantId: string, status: string, reason = "Inadimplência há 60 dias", s = session) =>
  postJson(env, `/master/tenants/${tenantId}/status`, { status, reason }, s.cookie, s.csrf);

/** Novo código, no passo seguinte ao do login (o anterior já foi usado). */
async function reauth(s = session) {
  now = new Date(now.getTime() + 30_000);
  return postJson(env, "/master/auth/reauth", { code: codeFor(master, now) }, s.cookie, s.csrf);
}

describe("listagem sem dados de clientes", () => {
  it("traz metadados e contagens das duas empresas", async () => {
    const owner = await loginOk(env, a.email);
    const customerId = await newCustomer(env, owner, "Cliente Secreto Silva", "(85) 98888-7777");
    await newDevice(env, owner, customerId);
    const res = await getWith(env, "/master/tenants", session.cookie);
    expect(res.statusCode).toBe(200);
    const tenants = res.json().tenants as Array<{ id: string; status: string; activeMembers: number; workOrders: number }>;
    expect(tenants.map((t) => t.id).sort()).toEqual([a.tenantId, b.tenantId].sort());
    expect(tenants.find((t) => t.id === a.tenantId)).toMatchObject({ activeMembers: 1, workOrders: 0 });
  });

  it("nenhum nome, telefone, e-mail ou texto de cliente aparece em qualquer resposta do Master", async () => {
    const owner = await loginOk(env, a.email);
    const customerId = await newCustomer(env, owner, "Cliente Secreto Silva", "(85) 98888-7777");
    await call(env, owner, "PATCH", `/customers/${customerId}`, { email: "segredo.cliente@teste.invalid" });
    const bodies = [
      (await getWith(env, "/master/tenants", session.cookie)).body,
      (await getWith(env, "/master/me", session.cookie)).body,
      (await setStatus(a.tenantId, "suspensa")).body,
    ];
    await reauth();
    bodies.push((await setStatus(a.tenantId, "suspensa")).body);
    for (const body of bodies) {
      expect(body).not.toMatch(/Cliente Secreto|98888|segredo\.cliente|Silva/);
      expect(body).not.toContain(a.email);
    }
  });

  it("o Master não tem caminho às tabelas de uma empresa: as rotas de empresa respondem 401 com o cookie dele", async () => {
    for (const url of ["/customers", "/work-orders", "/team", "/dashboard", "/devices"]) {
      expect((await getWith(env, url, session.cookie)).statusCode, url).toBe(401);
    }
  });

  it("exige sessão", async () => {
    expect((await getWith(env, "/master/tenants")).statusCode).toBe(401);
    expect((await postJson(env, `/master/tenants/${a.tenantId}/status`, { status: "suspensa", reason: "teste de motivo" })).statusCode).toBe(401);
  });
});

describe("suspender e reativar", () => {
  it("sem código recente, a mudança é recusada e a empresa continua ativa", async () => {
    now = new Date(now.getTime() + 6 * 60 * 1000);
    const res = await setStatus(a.tenantId, "suspensa");
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("REAUTENTICACAO_NECESSARIA");
    expect(await statusOf(a.tenantId)).not.toBe("suspensa");
  });

  it("um código novo reabre a janela; um código repetido não", async () => {
    now = new Date(now.getTime() + 6 * 60 * 1000);
    const reused = await postJson(env, "/master/auth/reauth", { code: codeFor(master, new Date(now.getTime() - 6 * 60 * 1000)) }, session.cookie, session.csrf);
    expect(reused.statusCode).toBe(401);
    expect((await setStatus(a.tenantId, "suspensa")).statusCode).toBe(403);
    expect((await reauth()).statusCode).toBe(204);
    expect((await setStatus(a.tenantId, "suspensa")).statusCode).toBe(204);
  });

  it("suspender derruba na hora as sessões abertas da empresa e impede novo login; a outra segue", async () => {
    const ownerA = await loginOk(env, a.email);
    const ownerB = await loginOk(env, b.email);
    expect((await call(env, ownerA, "GET", "/me")).statusCode).toBe(200);
    expect((await setStatus(a.tenantId, "suspensa")).statusCode).toBe(204);
    expect((await call(env, ownerA, "GET", "/me")).statusCode).toBe(401);
    expect((await call(env, ownerB, "GET", "/me")).statusCode).toBe(200);
    const login = await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: a.email, password: "senha-sintetica-123" } });
    expect(login.statusCode).toBe(401);
  });

  it("reativar devolve o acesso", async () => {
    await setStatus(a.tenantId, "suspensa");
    expect((await setStatus(a.tenantId, "ativa")).statusCode).toBe(204);
    expect((await loginOk(env, a.email)).cookie).toBeTruthy();
  });

  it("a ação fica na trilha da própria empresa, com motivo e sem dado pessoal; a outra empresa não vê", async () => {
    await setStatus(a.tenantId, "suspensa", "Pedido formal do dono");
    const eventsA = await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.select().from(schema.auditEvents));
    const row = eventsA.find((e) => e.action === "master_tenant_suspensa");
    expect(row).toMatchObject({ tenantId: a.tenantId, actorUserId: master.id, targetType: "tenant", targetId: a.tenantId, outcome: "ok", reason: "Pedido formal do dono" });
    const eventsB = await withContext(env.migrator, { tenantId: b.tenantId }, (db) => db.select().from(schema.auditEvents));
    expect(eventsB.some((e) => e.action.startsWith("master_"))).toBe(false);
  });

  it("regras: cancelada não muda, repetir é recusado, ativar só a partir de suspensa, empresa inexistente é 404", async () => {
    expect((await setStatus(a.tenantId, "ativa")).statusCode).toBe(422);
    expect((await setStatus(a.tenantId, "suspensa")).statusCode).toBe(204);
    expect((await setStatus(a.tenantId, "suspensa")).statusCode).toBe(422);
    await withContext(env.migrator, { tenantId: b.tenantId }, (db) => db.update(schema.tenants).set({ status: "cancelada" }));
    expect((await setStatus(b.tenantId, "ativa")).statusCode).toBe(422);
    expect((await setStatus(b.tenantId, "suspensa")).statusCode).toBe(422);
    expect((await setStatus("00000000-0000-4000-8000-000000000000", "suspensa")).statusCode).toBe(404);
  });

  it("corpo estrito: situação fora da lista (inclui cancelada), motivo curto e campo extra dão 400", async () => {
    expect((await setStatus(a.tenantId, "cancelada")).statusCode).toBe(400);
    expect((await setStatus(a.tenantId, "suspensa", "abc")).statusCode).toBe(400);
    expect((await postJson(env, `/master/tenants/${a.tenantId}/status`, { status: "suspensa", reason: "motivo válido", extra: 1 }, session.cookie, session.csrf)).statusCode).toBe(400);
    expect((await postJson(env, "/master/tenants/nao-e-uuid/status", { status: "suspensa", reason: "motivo válido" }, session.cookie, session.csrf)).statusCode).toBe(400);
  });
});

describe("não há outro caminho para criar ou ler Master", () => {
  it("nenhuma rota HTTP cria administrador do Master", async () => {
    for (const url of ["/master/admins", "/master/admin", "/master/users"]) {
      expect((await postJson(env, url, { email: "novo@plataforma.invalid", password: "x".repeat(20) }, session.cookie, session.csrf)).statusCode, url).toBe(404);
    }
  });

  it("o papel da aplicação não tem privilégio algum nas tabelas do Master", async () => {
    for (const table of ["platform_admins", "platform_sessions", "platform_challenges"]) {
      const res = await env.pool.query(`SELECT has_table_privilege('reparo_app', '${table}', 'SELECT,INSERT,UPDATE,DELETE') AS any_priv`);
      expect(res.rows[0].any_priv, table).toBe(false);
      await expect(env.pool.query(`SELECT * FROM ${table}`), table).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("as funções do Master recusam hash de sessão inventado ou expirado", async () => {
    await expect(env.pool.query("SELECT * FROM master_list_tenants($1, now())", ["hash-inventado"])).rejects.toMatchObject({ code: "28000" });
    await expect(env.pool.query("SELECT master_set_tenant_status($1, now(), $2, 'suspensa', 'motivo válido', 'c', '1.1.1.1')", ["hash-inventado", a.tenantId])).rejects.toMatchObject({ code: "28000" });
    const live = await env.migrator.query("SELECT token_hash FROM platform_sessions LIMIT 1");
    await expect(env.pool.query("SELECT * FROM master_list_tenants($1, $2)", [live.rows[0].token_hash, new Date("2027-01-01T00:00:00Z")])).rejects.toMatchObject({ code: "28000" });
  });

  it("depois de listar, o contexto de empresa não vaza para a próxima consulta da conexão", async () => {
    await getWith(env, "/master/tenants", session.cookie);
    const res = await env.pool.query("SELECT current_setting('app.tenant_id', true) AS t, current_setting('app.master_op', true) AS m");
    expect([null, ""]).toContain(res.rows[0].t);
    expect([null, ""]).toContain(res.rows[0].m);
  });
});
