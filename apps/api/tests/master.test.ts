import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, loginOk, onboard, resetData, startTestEnv, type TestEnv } from "./helpers.js";
import {
  asTenantCookie, codeFor, getWith, MASTER_COOKIE, MASTER_KEY_HEX, MASTER_PASSWORD, masterLogin, passwordStep, postJson, seedMaster,
  type TestMaster,
} from "./master-helpers.js";

let env: TestEnv;
let now: Date;
let master: TestMaster;
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
});

describe("desligado por padrão (falha fechada)", () => {
  it("sem MASTER_ENC_KEY as rotas do Master não existem", async () => {
    const off = await startTestEnv({});
    try {
      expect((await postJson(off, "/master/auth/login", { email: master.email, password: MASTER_PASSWORD })).statusCode).toBe(404);
      expect((await getWith(off, "/master/tenants")).statusCode).toBe(404);
    } finally {
      await off.close();
    }
  });
});

describe("entrada em duas etapas", () => {
  it("só a senha não cria sessão: nenhum cookie e nenhuma rota abre", async () => {
    const first = await passwordStep(env, master);
    expect(first.statusCode).toBe(200);
    expect(first.cookies).toHaveLength(0);
    expect(first.json().challenge).toHaveLength(43);
    expect((await getWith(env, "/master/me")).statusCode).toBe(401);
    expect((await getWith(env, "/master/me", `${MASTER_COOKIE}=${first.json().challenge}`)).statusCode).toBe(401);
  });

  it("senha e código certos abrem a sessão: cookie fechado e /master/me responde", async () => {
    const first = await passwordStep(env, master);
    const second = await postJson(env, "/master/auth/mfa", { challenge: first.json().challenge, code: codeFor(master, now) });
    expect(second.statusCode).toBe(200);
    const cookie = second.cookies.find((c) => c.name === MASTER_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict", path: "/" });
    expect(cookie?.domain).toBeUndefined();
    const me = await getWith(env, "/master/me", `${MASTER_COOKIE}=${cookie?.value}`);
    expect(me.statusCode).toBe(200);
    expect(me.json().admin.email).toBe(master.email);
    expect(me.headers["cache-control"]).toBe("no-store");
  });

  it("senha errada e e-mail inexistente respondem igual", async () => {
    const wrong = await passwordStep(env, master, "senha-errada-123456");
    const missing = await postJson(env, "/master/auth/login", { email: "ninguem@plataforma.invalid", password: MASTER_PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(missing.statusCode).toBe(401);
    expect(wrong.json()).toEqual(missing.json());
  });

  it("usuário de uma assistência não entra como Master, mesmo com a senha certa dele", async () => {
    const acc = await onboard(env, "empresaX");
    const res = await postJson(env, "/master/auth/login", { email: acc.email, password: "senha-sintetica-123" });
    expect(res.statusCode).toBe(401);
  });

  it("código errado: 401 igual ao de desafio inexistente, e o erro é contado no banco", async () => {
    const first = await passwordStep(env, master);
    const wrongCode = codeFor(master, now) === "000000" ? "111111" : "000000";
    const wrong = await postJson(env, "/master/auth/mfa", { challenge: first.json().challenge, code: wrongCode });
    const ghost = await postJson(env, "/master/auth/mfa", { challenge: "x".repeat(43), code: wrongCode });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(ghost.json());
    const rows = await env.migrator.query("SELECT attempts FROM platform_challenges");
    expect(rows.rows[0].attempts).toBe(1);
  });

  it("5 códigos errados esgotam o desafio: o certo depois também é recusado", async () => {
    const first = await passwordStep(env, master);
    const right = codeFor(master, now);
    const wrongCode = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect((await postJson(env, "/master/auth/mfa", { challenge: first.json().challenge, code: wrongCode })).statusCode).toBe(401);
    }
    const late = await postJson(env, "/master/auth/mfa", { challenge: first.json().challenge, code: right });
    expect(late.statusCode).toBe(401);
    expect(late.cookies).toHaveLength(0);
  });

  it("desafio vence em 5 minutos", async () => {
    const first = await passwordStep(env, master);
    const code = codeFor(master, now);
    now = new Date(now.getTime() + 5 * 60 * 1000 + 1000);
    expect((await postJson(env, "/master/auth/mfa", { challenge: first.json().challenge, code })).statusCode).toBe(401);
  });

  it("o desafio vale uma vez: refazer com o mesmo desafio não cria outra sessão", async () => {
    const first = await passwordStep(env, master);
    const code = codeFor(master, now);
    expect((await postJson(env, "/master/auth/mfa", { challenge: first.json().challenge, code })).statusCode).toBe(200);
    now = new Date(now.getTime() + 30_000);
    expect((await postJson(env, "/master/auth/mfa", { challenge: first.json().challenge, code: codeFor(master, now) })).statusCode).toBe(401);
  });

  it("um código já usado não vale de novo, nem em outro desafio, nem o de passo anterior", async () => {
    await masterLogin(env, master, now);
    const again = await passwordStep(env, master);
    expect((await postJson(env, "/master/auth/mfa", { challenge: again.json().challenge, code: codeFor(master, now) })).statusCode).toBe(401);
    const older = await passwordStep(env, master);
    expect((await postJson(env, "/master/auth/mfa", { challenge: older.json().challenge, code: codeFor(master, now, -1) })).statusCode).toBe(401);
    now = new Date(now.getTime() + 30_000);
    expect((await masterLogin(env, master, now)).cookie).toContain(MASTER_COOKIE);
  });

  it("aceita relógio adiantado ou atrasado em um passo (30 s), e não mais que isso", async () => {
    const early = await passwordStep(env, master);
    expect((await postJson(env, "/master/auth/mfa", { challenge: early.json().challenge, code: codeFor(master, now, 1) })).statusCode).toBe(200);
    const far = await passwordStep(env, master);
    expect((await postJson(env, "/master/auth/mfa", { challenge: far.json().challenge, code: codeFor(master, now, 3) })).statusCode).toBe(401);
  });

  it("corpo estrito: campo extra e código mal formado dão 400", async () => {
    const first = await passwordStep(env, master);
    const challenge = first.json().challenge;
    expect((await postJson(env, "/master/auth/mfa", { challenge, code: "12345" })).statusCode).toBe(400);
    expect((await postJson(env, "/master/auth/mfa", { challenge, code: "123456", extra: 1 })).statusCode).toBe(400);
    expect((await postJson(env, "/master/auth/login", { email: master.email, password: "x", tenantId: "y" })).statusCode).toBe(400);
  });
});

describe("sessão", () => {
  it("é separada da sessão das assistências, nas duas direções", async () => {
    const acc = await onboard(env, "empresaY");
    const tenant = await loginOk(env, acc.email);
    const session = await masterLogin(env, master, now);
    expect((await getWith(env, "/master/tenants", asTenantCookie(tenant).replace(/^[^=]+/, MASTER_COOKIE))).statusCode).toBe(401);
    expect((await getWith(env, "/master/tenants", tenant.cookie)).statusCode).toBe(401);
    expect((await call(env, { ...tenant, cookie: asTenantCookie(session) }, "GET", "/me")).statusCode).toBe(401);
    expect((await call(env, { ...tenant, cookie: session.cookie }, "GET", "/team")).statusCode).toBe(401);
  });

  it("exige token CSRF nos métodos que alteram", async () => {
    const session = await masterLogin(env, master, now);
    expect((await postJson(env, "/master/auth/reauth", { code: "123456" }, session.cookie)).statusCode).toBe(403);
    expect((await postJson(env, "/master/auth/reauth", { code: "123456" }, session.cookie, "errado")).statusCode).toBe(403);
  });

  it("vence por inatividade (30 min) e por validade absoluta (4 h)", async () => {
    const idle = await masterLogin(env, master, now);
    now = new Date(now.getTime() + 31 * 60 * 1000);
    expect((await getWith(env, "/master/me", idle.cookie)).statusCode).toBe(401);

    now = new Date("2026-11-11T12:00:00Z");
    const long = await masterLogin(env, master, now);
    for (let i = 0; i < 9; i++) {
      now = new Date(now.getTime() + 28 * 60 * 1000);
      const status = (await getWith(env, "/master/me", long.cookie)).statusCode;
      if (now.getTime() - new Date("2026-11-11T12:00:00Z").getTime() < 4 * 60 * 60 * 1000) expect(status).toBe(200);
      else expect(status).toBe(401);
    }
  });

  it("sair revoga a sessão: o mesmo cookie deixa de valer", async () => {
    const session = await masterLogin(env, master, now);
    expect((await postJson(env, "/master/auth/logout", {}, session.cookie, session.csrf)).statusCode).toBe(204);
    expect((await getWith(env, "/master/me", session.cookie)).statusCode).toBe(401);
  });

  it("administrador desativado perde a sessão na hora", async () => {
    const session = await masterLogin(env, master, now);
    await env.migrator.query("UPDATE platform_admins SET status = 'inativo' WHERE id = $1", [master.id]);
    expect((await getWith(env, "/master/me", session.cookie)).statusCode).toBe(401);
    expect((await passwordStep(env, master)).statusCode).toBe(401);
  });

  it("muitas senhas erradas bloqueiam aquela combinação (429), até com a senha certa", async () => {
    const strict = await startTestEnv({ MASTER_ENC_KEY: MASTER_KEY_HEX, LOGIN_ACCOUNT_MAX_FAILURES: "3" }, () => now);
    try {
      for (let i = 0; i < 3; i++) expect((await passwordStep(strict, master, "senha-errada-123456")).statusCode).toBe(401);
      expect((await passwordStep(strict, master)).statusCode).toBe(429);
    } finally {
      await strict.close();
    }
  });
});

describe("armazenamento e logs", () => {
  it("senha em Argon2 e segredo MFA cifrado; nada em claro no banco", async () => {
    const row = (await env.migrator.query("SELECT password_hash, totp_secret_enc FROM platform_admins WHERE id = $1", [master.id])).rows[0];
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.totp_secret_enc.split(".")).toHaveLength(3);
    expect(row.totp_secret_enc).not.toContain(master.secret.toString("base64url"));
  });

  it("senha, código, desafio e cookie não aparecem nos logs", async () => {
    const first = await passwordStep(env, master);
    const code = codeFor(master, now);
    const second = await postJson(env, "/master/auth/mfa", { challenge: first.json().challenge, code });
    const cookie = second.cookies.find((c) => c.name === MASTER_COOKIE)?.value ?? "";
    await getWith(env, "/master/me", `${MASTER_COOKIE}=${cookie}`);
    const logs = logLines.join("");
    for (const secret of [MASTER_PASSWORD, `"code":"${code}"`, first.json().challenge, cookie, second.json().csrfToken]) {
      expect(logs).not.toContain(secret);
    }
  });
});
