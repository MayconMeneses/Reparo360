import { schema, withContext } from "@reparo360/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, login, resetData, startTestEnv, type TestEnv } from "./helpers.js";
import { codeFor, MASTER_KEY_HEX, masterLogin, postJson, seedMaster, type MasterSession, type TestMaster } from "./master-helpers.js";

let env: TestEnv;
let now: Date;
let master: TestMaster;
let session: MasterSession;
const logLines: string[] = [];

beforeAll(async () => {
  env = await startTestEnv(
    { MASTER_ENC_KEY: MASTER_KEY_HEX, LOG_LEVEL: "info", LOGIN_ACCOUNT_MAX_FAILURES: "1000" },
    () => now,
    { write: (chunk: string) => void logLines.push(chunk) },
  );
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  now = new Date("2026-11-10T12:00:00Z");
  logLines.length = 0;
  await resetData(env.migrator);
  await env.migrator.query("TRUNCATE platform_sessions, platform_challenges, platform_admins CASCADE");
  master = await seedMaster(env);
  session = await masterLogin(env, master, now);
});

const NEW = { tenantName: "Assistência Nova", ownerName: "Dona Nova", ownerEmail: "dona.nova@teste.invalid" };
const create = (payload: object = NEW, s = session) => postJson(env, "/master/tenants", payload, s.cookie, s.csrf);
const NEW_PASSWORD = "minha-senha-nova-segura-1";

async function ownerWithTemporary() {
  const res = await create();
  const body = res.json<{ tenantId: string; temporaryPassword: string }>();
  const entered = await login(env, NEW.ownerEmail, undefined, body.temporaryPassword);
  if (!entered.session) throw new Error(`login do dono falhou: ${entered.res.statusCode}`);
  return { ...body, owner: entered.session };
}

describe("criar assistência pelo Master", () => {
  it("exige sessão, token CSRF e código recente", async () => {
    expect((await postJson(env, "/master/tenants", NEW)).statusCode).toBe(401);
    expect((await postJson(env, "/master/tenants", NEW, session.cookie)).statusCode).toBe(403);
    now = new Date(now.getTime() + 6 * 60 * 1000);
    const stale = await create();
    expect(stale.statusCode).toBe(403);
    expect(stale.json().error.code).toBe("REAUTENTICACAO_NECESSARIA");
    const rows = await env.migrator.query("SELECT count(*)::int AS n FROM users WHERE email = $1", [NEW.ownerEmail]);
    expect(rows.rows[0].n).toBe(0);
  });

  it("cria empresa e dono; a senha temporária é gerada pelo servidor e mostrada uma vez", async () => {
    const res = await create();
    expect(res.statusCode).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json<{ tenantId: string; ownerEmail: string; temporaryPassword: string }>();
    expect(body.ownerEmail).toBe(NEW.ownerEmail);
    expect(body.temporaryPassword.length).toBeGreaterThanOrEqual(16);
    const second = await postJson(env, "/master/tenants", { ...NEW, ownerEmail: "outra@teste.invalid" }, session.cookie, session.csrf);
    expect(second.json().temporaryPassword).not.toBe(body.temporaryPassword);
    // A listagem não repete a senha nem o e-mail do dono.
    const list = await env.app.inject({ method: "GET", url: "/api/v1/master/tenants", headers: { cookie: session.cookie } });
    expect(list.body).not.toContain(body.temporaryPassword);
    expect(list.body).not.toContain(NEW.ownerEmail);
  });

  it("o Master não escolhe a senha: campo de senha é recusado", async () => {
    expect((await create({ ...NEW, ownerPassword: "senha-que-eu-escolhi-1" })).statusCode).toBe(400);
    expect((await create({ ...NEW, password: "senha-que-eu-escolhi-1" })).statusCode).toBe(400);
    expect((await create({ ...NEW, ownerEmail: "nao-e-email" })).statusCode).toBe(400);
    expect((await create({ tenantName: "A" })).statusCode).toBe(400);
  });

  it("e-mail já cadastrado: 409, sem empresa pela metade", async () => {
    await create();
    const again = await create({ ...NEW, tenantName: "Outra Empresa" });
    expect(again.statusCode).toBe(409);
    const listed = await env.app.inject({ method: "GET", url: "/api/v1/master/tenants", headers: { cookie: session.cookie } });
    expect(listed.json().tenants).toHaveLength(1);
  });

  it("a senha temporária não aparece em log, auditoria nem no banco em claro; a ação fica na trilha da empresa", async () => {
    const { tenantId, temporaryPassword } = await ownerWithTemporary();
    expect(logLines.join("")).not.toContain(temporaryPassword);
    const user = await env.migrator.query("SELECT password_hash, must_change_password FROM users WHERE email = $1", [NEW.ownerEmail]);
    expect(user.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(user.rows[0].must_change_password).toBe(true);
    const events = await withContext(env.migrator, { tenantId }, (db) => db.select().from(schema.auditEvents));
    expect(JSON.stringify(events)).not.toContain(temporaryPassword);
    expect(events.find((e) => e.action === "master_tenant_created")).toMatchObject({ tenantId, actorUserId: master.id, targetId: tenantId, outcome: "ok" });
    const listed = await env.app.inject({ method: "GET", url: "/api/v1/master/tenants", headers: { cookie: session.cookie } });
    expect(listed.json().tenants.map((t: { id: string }) => t.id)).toContain(tenantId);
  });
});

describe("senha temporária: nada funciona até trocar", () => {
  it("o dono entra, mas só consegue ver quem é, sair e trocar a senha", async () => {
    const { owner } = await ownerWithTemporary();
    const me = await call(env, owner, "GET", "/me");
    expect(me.statusCode).toBe(200);
    expect(me.json().senhaTemporaria).toBe(true);
    for (const [method, url] of [["GET", "/team"], ["GET", "/customers"], ["GET", "/work-orders"], ["GET", "/dashboard"], ["GET", "/devices"], ["POST", "/customers"]] as const) {
      const res = await call(env, owner, method, url, method === "POST" ? {} : undefined);
      expect(res.statusCode, url).toBe(403);
      expect(res.json().error.code, url).toBe("TROCA_DE_SENHA_OBRIGATORIA");
    }
  });

  it("senha atual errada, nova curta ou igual à atual são recusadas e nada muda", async () => {
    const { owner, temporaryPassword } = await ownerWithTemporary();
    expect((await call(env, owner, "POST", "/auth/change-password", { currentPassword: "errada-errada-123", newPassword: NEW_PASSWORD })).statusCode).toBe(401);
    expect((await call(env, owner, "POST", "/auth/change-password", { currentPassword: temporaryPassword, newPassword: "curta" })).statusCode).toBe(400);
    expect((await call(env, owner, "POST", "/auth/change-password", { currentPassword: temporaryPassword, newPassword: temporaryPassword })).statusCode).toBe(422);
    expect((await call(env, owner, "POST", "/auth/change-password", { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD, extra: 1 })).statusCode).toBe(400);
    expect((await call(env, owner, "GET", "/team")).statusCode).toBe(403);
  });

  it("trocar libera o sistema, invalida a temporária e encerra as outras sessões", async () => {
    const { owner, temporaryPassword } = await ownerWithTemporary();
    const other = await login(env, NEW.ownerEmail, undefined, temporaryPassword);
    expect((await call(env, owner, "POST", "/auth/change-password", { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD })).statusCode).toBe(204);
    expect((await call(env, owner, "GET", "/team")).statusCode).toBe(200);
    expect((await call(env, owner, "GET", "/me")).json().senhaTemporaria).toBe(false);
    expect((await call(env, other.session!, "GET", "/me")).statusCode).toBe(401);
    expect((await login(env, NEW.ownerEmail, undefined, temporaryPassword)).res.statusCode).toBe(401);
    expect((await login(env, NEW.ownerEmail, undefined, NEW_PASSWORD)).session).toBeTruthy();
  });

  it("a troca fica na auditoria, sem a senha", async () => {
    const { owner, tenantId, temporaryPassword } = await ownerWithTemporary();
    await call(env, owner, "POST", "/auth/change-password", { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD });
    const events = await withContext(env.migrator, { tenantId }, (db) => db.select().from(schema.auditEvents));
    expect(events.some((e) => e.action === "password_changed" && e.outcome === "ok")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(NEW_PASSWORD);
    expect(logLines.join("")).not.toContain(NEW_PASSWORD);
  });

  it("contas normais (sem senha temporária) não são afetadas", async () => {
    const { owner, temporaryPassword } = await ownerWithTemporary();
    await call(env, owner, "POST", "/auth/change-password", { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD });
    const member = await call(env, owner, "POST", "/team/members", { name: "Membro Novo", email: "membro@teste.invalid", password: "senha-inicial-123", role: "atendente" });
    expect(member.statusCode).toBe(201);
    const session2 = (await login(env, "membro@teste.invalid", undefined, "senha-inicial-123")).session!;
    expect((await call(env, session2, "GET", "/customers")).statusCode).toBe(200);
  });

  it("depois de suspensa a empresa, nem a troca de senha funciona (sessão cai)", async () => {
    const { owner, tenantId } = await ownerWithTemporary();
    await postJson(env, "/master/auth/reauth", { code: codeFor(master, new Date(now.getTime() + 30_000)) }, session.cookie, session.csrf);
    now = new Date(now.getTime() + 30_000);
    expect((await postJson(env, `/master/tenants/${tenantId}/status`, { status: "suspensa", reason: "Teste de suspensão" }, session.cookie, session.csrf)).statusCode).toBe(204);
    expect((await call(env, owner, "GET", "/me")).statusCode).toBe(401);
  });
});
