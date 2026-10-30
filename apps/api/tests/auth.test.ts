import { schema, withContext } from "@reparo360/database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, COOKIE_NAME, login, loginOk, onboard, PASSWORD, resetData, sessionsOf, startTestEnv, type Account, type TestEnv } from "./helpers.js";

let env: TestEnv;
let owner: Account;

beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetData(env.migrator);
  owner = await onboard(env, "auth");
});

describe("onboarding", () => {
  it("fica desabilitado por padrão", async () => {
    const closed = await startTestEnv({ ALLOW_PUBLIC_ONBOARDING: "false" });
    try {
      const res = await closed.app.inject({
        method: "POST",
        url: "/api/v1/tenants",
        payload: { tenantName: "Fechada", ownerName: "Alguém", ownerEmail: "x@teste.invalid", ownerPassword: PASSWORD },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("CADASTRO_DESABILITADO");
    } finally {
      await closed.close();
    }
  });

  it("rejeita senha curta e campos desconhecidos", async () => {
    const base = { tenantName: "Loja", ownerName: "Dono", ownerEmail: "novo@teste.invalid", ownerPassword: PASSWORD };
    const short = await env.app.inject({ method: "POST", url: "/api/v1/tenants", payload: { ...base, ownerPassword: "curta" } });
    expect(short.statusCode).toBe(400);
    const extra = await env.app.inject({ method: "POST", url: "/api/v1/tenants", payload: { ...base, status: "ativa" } });
    expect(extra.statusCode).toBe(400);
  });

  it("e-mail repetido retorna 409", async () => {
    const res = await env.app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      payload: { tenantName: "Outra", ownerName: "Dono", ownerEmail: owner.email, ownerPassword: PASSWORD },
    });
    expect(res.statusCode).toBe(409);
  });

  it("armazena a senha com Argon2id", async () => {
    const row = await env.migrator.query("SELECT password_hash FROM users WHERE email = $1", [owner.email]);
    expect(row.rows[0].password_hash.startsWith("$argon2id$")).toBe(true);
  });
});

describe("login e sessão", () => {
  it("cookie sai HttpOnly, Secure, SameSite=Strict, Path=/ e com prefixo __Host-", async () => {
    const { res } = await login(env, owner.email);
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie.startsWith(`${COOKIE_NAME}=`)).toBe(true);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Domain=/i);
  });

  it("o banco guarda só o hash do token, nunca o token", async () => {
    const { rawToken } = await login(env, owner.email);
    const [row] = await sessionsOf(env, owner.tenantId);
    expect(rawToken).toBeTruthy();
    expect(row?.tokenHash).not.toBe(rawToken);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("senha errada e e-mail inexistente respondem igual (sem enumeração)", async () => {
    const wrong = await login(env, owner.email, undefined, "senha-errada-123456");
    const unknown = await login(env, "ninguem@teste.invalid", undefined, "senha-errada-123456");
    expect(wrong.res.statusCode).toBe(401);
    expect(unknown.res.statusCode).toBe(401);
    expect(wrong.res.json()).toEqual(unknown.res.json());
    expect(wrong.res.headers["set-cookie"]).toBeUndefined();
  });

  it("sem cookie, rotas protegidas retornam 401", async () => {
    expect((await call(env, null, "GET", "/me")).statusCode).toBe(401);
    expect((await call(env, null, "GET", "/team")).statusCode).toBe(401);
  });

  it("cookie forjado retorna 401", async () => {
    const res = await env.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: `${COOKIE_NAME}=token-inventado` } });
    expect(res.statusCode).toBe(401);
  });

  it("logout revoga a sessão: reutilizar o cookie falha", async () => {
    const session = await loginOk(env, owner.email);
    expect((await call(env, session, "GET", "/me")).statusCode).toBe(200);
    expect((await call(env, session, "POST", "/auth/logout")).statusCode).toBe(204);
    expect((await call(env, session, "GET", "/me")).statusCode).toBe(401);
  });

  it("sessão expirada (validade absoluta) retorna 401", async () => {
    const session = await loginOk(env, owner.email);
    await withContext(env.migrator, { tenantId: owner.tenantId }, (db) =>
      db.update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) }));
    expect((await call(env, session, "GET", "/me")).statusCode).toBe(401);
  });

  it("sessão inativa por mais de 2 h retorna 401", async () => {
    const session = await loginOk(env, owner.email);
    await withContext(env.migrator, { tenantId: owner.tenantId }, (db) =>
      db.update(schema.sessions).set({ lastSeenAt: new Date(Date.now() - 3 * 3600_000) }));
    expect((await call(env, session, "GET", "/me")).statusCode).toBe(401);
  });

  it("usuário desativado perde o acesso imediatamente", async () => {
    const session = await loginOk(env, owner.email);
    await env.migrator.query("UPDATE users SET status = 'desativado' WHERE email = $1", [owner.email]);
    expect((await call(env, session, "GET", "/me")).statusCode).toBe(401);
    expect((await login(env, owner.email)).res.statusCode).toBe(401);
  });

  it("empresa suspensa bloqueia login e sessões abertas", async () => {
    const session = await loginOk(env, owner.email);
    await withContext(env.migrator, { tenantId: owner.tenantId }, (db) =>
      db.update(schema.tenants).set({ status: "suspensa" }).where(eq(schema.tenants.id, owner.tenantId)));
    expect((await call(env, session, "GET", "/me")).statusCode).toBe(401);
    expect((await login(env, owner.email)).res.statusCode).toBe(401);
  });

  it("limita tentativas de login (429)", async () => {
    const limited = await startTestEnv({ LOGIN_RATE_LIMIT_MAX: "3" });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) {
        const res = await limited.app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email: "alvo@teste.invalid", password: "qualquer-senha-123" },
        });
        codes.push(res.statusCode);
      }
      expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
      expect(codes.slice(3)).toEqual([429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe("CSRF", () => {
  it("método mutável sem token CSRF retorna 403", async () => {
    const session = await loginOk(env, owner.email);
    const res = await env.app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie: session.cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("CSRF_INVALIDO");
  });

  it("token CSRF de outra sessão é rejeitado", async () => {
    const first = await loginOk(env, owner.email);
    const second = await loginOk(env, owner.email);
    const res = await env.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie: first.cookie, "x-csrf-token": second.csrf },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("vazamento de dados sensíveis", () => {
  it("nenhuma resposta expõe hash de senha", async () => {
    const session = await loginOk(env, owner.email);
    const bodies = [
      (await call(env, session, "GET", "/me")).body,
      (await call(env, session, "GET", "/team")).body,
    ];
    for (const body of bodies) expect(body).not.toMatch(/argon2|password|senha_hash/i);
  });

  it("respostas não são cacheáveis e carregam ID de correlação", async () => {
    const res = await env.app.inject({ method: "GET", url: "/health" });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });
});
