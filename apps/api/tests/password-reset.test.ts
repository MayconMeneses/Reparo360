import { schema, withContext } from "@reparo360/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, login, loginOk, onboard, PASSWORD, resetData, startTestEnv, type Account, type TestEnv } from "./helpers.js";
import { MemoryMailer, PUBLIC_URL, SECRET } from "./remote-helpers.js";
import { seedMaster } from "./master-helpers.js";

let env: TestEnv;
let mailer: MemoryMailer;
let now: Date;
let a: Account;
const logLines: string[] = [];
const NEW_PASSWORD = "senha-nova-definitiva-9";

beforeAll(async () => {
  mailer = new MemoryMailer();
  env = await startTestEnv({ LOG_LEVEL: "info", VERIFICATION_SECRET: SECRET, PUBLIC_URL, LOGIN_RATE_LIMIT_MAX: "1000" }, () => now, { write: (c: string) => void logLines.push(c) }, mailer);
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  now = new Date("2026-11-12T12:00:00Z");
  logLines.length = 0;
  mailer.outbox.length = 0;
  mailer.failNext = false;
  await resetData(env.migrator);
  a = await onboard(env, "senhaA");
});

const request = (email: string, headers: Record<string, string> = {}) =>
  env.app.inject({ method: "POST", url: "/api/v1/auth/password-reset/request", headers, payload: { email } });
const confirm = (token: string, newPassword = NEW_PASSWORD) =>
  env.app.inject({ method: "POST", url: "/api/v1/auth/password-reset/confirm", payload: { token, newPassword } });
/** O envio acontece depois da resposta: espera a mensagem chegar ao coletor. */
async function mailCount(n: number) {
  for (let i = 0; i < 100 && mailer.outbox.length < n; i++) await new Promise((r) => setTimeout(r, 20));
  return mailer.outbox.length;
}
const tokenOf = (text: string) => /#t=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? "";
async function issueToken(email = a.email) {
  const before = mailer.outbox.length;
  expect((await request(email)).statusCode).toBe(202);
  expect(await mailCount(before + 1)).toBe(before + 1);
  return tokenOf(mailer.outbox.at(-1)!.text);
}

describe("pedir a redefinição", () => {
  it("a tela de entrada só oferece o link quando o envio de e-mail está ligado", async () => {
    expect((await env.app.inject({ method: "GET", url: "/api/v1/auth/options" })).json()).toEqual({ passwordReset: true });
    const off = await startTestEnv({});
    try {
      expect((await off.app.inject({ method: "GET", url: "/api/v1/auth/options" })).json()).toEqual({ passwordReset: false });
    } finally {
      await off.close();
    }
  });

  it("conta existente recebe o link (montado com PUBLIC_URL, token no fragmento) e nada de senha", async () => {
    expect((await request(a.email)).statusCode).toBe(202);
    expect(await mailCount(1)).toBe(1);
    const mail = mailer.outbox[0]!;
    expect(mail.to).toBe(a.email);
    expect(mail.text).toContain(`${PUBLIC_URL}/redefinir-senha#t=`);
    expect(tokenOf(mail.text)).toHaveLength(43);
    expect(mail.text).not.toContain(PASSWORD);
    const rows = await env.migrator.query("SELECT token_hash, purpose FROM password_tokens");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].token_hash).not.toContain(tokenOf(mail.text)); // só o hash fica no banco
    expect(rows.rows[0].purpose).toBe("redefinicao");
  });

  it("cabeçalhos Host/X-Forwarded-Host forjados NÃO mudam o endereço do link", async () => {
    await request(a.email, { host: "evil.invalid", "x-forwarded-host": "evil.invalid", origin: "https://evil.invalid" });
    await mailCount(1);
    expect(mailer.outbox[0]!.text).toContain(PUBLIC_URL);
    expect(mailer.outbox[0]!.text).not.toContain("evil.invalid");
  });

  it("a resposta é idêntica para conta existente, inexistente, inativa e quando o envio falha", async () => {
    const inactive = await onboard(env, "inativa");
    await env.migrator.query("UPDATE users SET status = 'desativado' WHERE email = $1", [inactive.email]);
    const responses = [];
    for (const email of [a.email, "ninguem@teste.invalid", inactive.email]) {
      const res = await request(email);
      responses.push({ status: res.statusCode, body: res.body, type: res.headers["content-type"], cache: res.headers["cache-control"] });
    }
    mailer.failNext = true;
    const failing = await request(a.email);
    responses.push({ status: failing.statusCode, body: failing.body, type: failing.headers["content-type"], cache: failing.headers["cache-control"] });
    for (const r of responses) expect(r).toEqual(responses[0]);
    expect(responses[0]).toMatchObject({ status: 202, body: '{"accepted":true}' });
    await new Promise((r) => setTimeout(r, 200));
    expect(mailer.outbox.map((m) => m.to)).toEqual([a.email]); // só a conta ativa recebeu (a 2ª tentativa falhou de propósito)
  });

  it("limite por conta: a 4ª mensagem na mesma hora não é enviada, mas a resposta continua igual", async () => {
    const bodies = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const res = await request(a.email);
      expect(res.statusCode).toBe(202);
      bodies.add(res.body);
      now = new Date(now.getTime() + 61_000);
    }
    await new Promise((r) => setTimeout(r, 300));
    expect(bodies.size).toBe(1);
    expect(mailer.outbox).toHaveLength(3);
  });

  it("sem envio de e-mail configurado, responde igual e não envia nada", async () => {
    const off = await startTestEnv({});
    try {
      const res = await off.app.inject({ method: "POST", url: "/api/v1/auth/password-reset/request", payload: { email: a.email } });
      expect(res.statusCode).toBe(202);
      expect(res.body).toBe('{"accepted":true}');
    } finally {
      await off.close();
    }
  });

  it("administrador da plataforma (Master) não é afetado: tabela separada, nenhum e-mail", async () => {
    const master = await seedMaster(env);
    const before = (await env.migrator.query("SELECT password_hash FROM platform_admins WHERE id = $1", [master.id])).rows[0].password_hash;
    expect((await request(master.email)).statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 200));
    expect(mailer.outbox).toHaveLength(0);
    expect((await env.migrator.query("SELECT password_hash FROM platform_admins WHERE id = $1", [master.id])).rows[0].password_hash).toBe(before);
  });

  it("corpo estrito: e-mail inválido ou campo extra dão 400", async () => {
    expect((await request("nao-e-email")).statusCode).toBe(400);
    const extra = await env.app.inject({ method: "POST", url: "/api/v1/auth/password-reset/request", payload: { email: a.email, tenantId: "x" } });
    expect(extra.statusCode).toBe(400);
  });
});

describe("confirmar a nova senha", () => {
  it("troca a senha: a nova entra, a antiga não, e a marca de senha temporária cai", async () => {
    await env.migrator.query("UPDATE users SET must_change_password = true WHERE email = $1", [a.email]);
    const token = await issueToken();
    expect((await confirm(token)).statusCode).toBe(204);
    expect((await login(env, a.email, undefined, NEW_PASSWORD)).session).toBeTruthy();
    expect((await login(env, a.email)).res.statusCode).toBe(401);
    const row = await env.migrator.query("SELECT must_change_password FROM users WHERE email = $1", [a.email]);
    expect(row.rows[0].must_change_password).toBe(false);
  });

  it("encerra TODAS as sessões da conta, em todas as empresas", async () => {
    const b = await onboard(env, "senhaB");
    const userId = a.userId;
    await withContext(env.migrator, { tenantId: b.tenantId }, (db) => db.insert(schema.memberships).values({ tenantId: b.tenantId, userId, role: "atendente" }));
    const inA = await loginOk(env, a.email, a.tenantId);
    const inB = await loginOk(env, a.email, b.tenantId);
    expect((await call(env, inA, "GET", "/me")).statusCode).toBe(200);
    expect((await call(env, inB, "GET", "/me")).statusCode).toBe(200);
    expect((await confirm(await issueToken())).statusCode).toBe(204);
    expect((await call(env, inA, "GET", "/me")).statusCode).toBe(401);
    expect((await call(env, inB, "GET", "/me")).statusCode).toBe(401);
  });

  it("o token vale uma vez; token errado, curto e vencido dão a MESMA resposta", async () => {
    const token = await issueToken();
    expect((await confirm(token)).statusCode).toBe(204);
    const reused = await confirm(token);
    const wrong = await confirm("x".repeat(43));
    expect(reused.statusCode).toBe(400);
    expect(reused.json().error.code).toBe("LINK_DE_SENHA_INVALIDO");
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toEqual(reused.json());
    expect((await confirm("curto")).statusCode).toBe(400); // formato inválido: recusado pela validação, sem consultar o banco
    const expired = await issueToken();
    now = new Date(now.getTime() + 31 * 60_000);
    const late = await confirm(expired);
    expect(late.statusCode).toBe(400);
    expect(late.json()).toEqual(reused.json());
    expect((await login(env, a.email, undefined, NEW_PASSWORD)).session).toBeTruthy(); // a 1ª troca valeu; a tardia não mexeu
  });

  it("dois pedidos simultâneos com o mesmo token: exatamente um vence (8 rodadas)", async () => {
    for (let round = 0; round < 8; round++) {
      mailer.outbox.length = 0;
      now = new Date(now.getTime() + 61 * 60_000);
      const token = await issueToken();
      const results = await Promise.all([confirm(token, `senha-rodada-${round}-aaaa`), confirm(token, `senha-rodada-${round}-bbbb`)]);
      expect(results.map((r) => r.statusCode).sort(), `rodada ${round}`).toEqual([204, 400]);
    }
  });

  it("usar um token invalida os outros que estavam em aberto", async () => {
    const first = await issueToken();
    now = new Date(now.getTime() + 61_000);
    const second = await issueToken();
    expect((await confirm(first)).statusCode).toBe(204);
    expect((await confirm(second)).statusCode).toBe(400);
  });

  it("senha fraca é recusada ANTES de gastar o token", async () => {
    const token = await issueToken();
    expect((await confirm(token, "curta")).statusCode).toBe(400);
    expect((await confirm(token)).statusCode).toBe(204);
  });

  it("conta desativada depois do pedido: o token não troca nada e nada fica pela metade", async () => {
    const token = await issueToken();
    await env.migrator.query("UPDATE users SET status = 'desativado' WHERE email = $1", [a.email]);
    expect((await confirm(token)).statusCode).toBe(400);
    const row = await env.migrator.query("SELECT used_at FROM password_tokens");
    expect(row.rows[0].used_at).toBeNull();
  });

  it("fica na auditoria (sem a senha) e nem token nem senha aparecem nos logs", async () => {
    const token = await issueToken();
    await confirm(token);
    const rows = await env.migrator.query("SELECT 1");
    expect(rows.rowCount).toBe(1);
    const audit = spawnPsql("SELECT action, actor_user_id FROM audit_events WHERE action = 'password_reset_done'");
    expect(audit).toContain("password_reset_done");
    expect(audit).not.toContain(NEW_PASSWORD);
    const logs = logLines.join("");
    for (const secret of [token, NEW_PASSWORD, a.email]) expect(logs).not.toContain(secret);
  });
});

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
function spawnPsql(statement: string): string {
  const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const res = spawnSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "reparo360_test", "-At", "-c", statement], { cwd: root, encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout;
}
