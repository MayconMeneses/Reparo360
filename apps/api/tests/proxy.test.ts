import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { onboard, resetData, startTestEnv, type TestEnv } from "./helpers.js";

// TRUST_PROXY decide se o cabeçalho X-Forwarded-For vale como IP do cliente. Ligado sem proxy na frente,
// qualquer um escolhe o próprio IP e foge do limite de tentativas; desligado atrás de proxy, todos parecem um só.
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
/** Falhas de login não têm empresa e a RLS esconde essas linhas até do dono: lê como superusuário, só para conferir. */
function failedLoginIps(): string[] {
  const res = spawnSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "reparo360_test", "-At", "-c",
    "SELECT ip FROM audit_events WHERE action = 'login' AND outcome = 'negado'"], { cwd: root, encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

const envs: TestEnv[] = [];
afterAll(async () => {
  for (const env of envs) await env.close();
});

async function start(trust: "true" | "false") {
  const env = await startTestEnv({ TRUST_PROXY: trust, LOGIN_RATE_LIMIT_MAX: "3", LOGIN_ACCOUNT_MAX_FAILURES: "1000" });
  envs.push(env);
  return env;
}

const attempt = (env: TestEnv, forwarded: string, email = "alguem@teste.invalid") =>
  env.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { "x-forwarded-for": forwarded },
    payload: { email, password: "senha-errada-123456" },
  });

describe("TRUST_PROXY desligado (padrão)", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env ??= await start("false");
    await resetData(env.migrator);
  });

  it("trocar o X-Forwarded-For a cada tentativa NÃO escapa do limite de login", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await attempt(env, `203.0.113.${i + 1}`)).statusCode);
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3).every((s) => s === 429)).toBe(true);
  });

  it("a auditoria guarda o IP da conexão, não o que o cliente alegou", async () => {
    // Servidor novo: o teste anterior já esgotou o limite deste IP e a tentativa nem chegaria à auditoria.
    const fresh = await start("false");
    await resetData(fresh.migrator);
    const acc = await onboard(fresh, "proxyOff");
    await attempt(fresh, "198.51.100.77", acc.email);
    const logged = failedLoginIps();
    expect(logged.length).toBeGreaterThan(0);
    expect(logged).not.toContain("198.51.100.77");
  });
});

describe("TRUST_PROXY ligado (só correto atrás de um proxy que reescreve o cabeçalho)", () => {
  let env: TestEnv;
  beforeEach(async () => {
    env ??= await start("true");
    await resetData(env.migrator);
  });

  it("o IP do cabeçalho passa a valer: IPs diferentes têm limites separados e o mesmo IP é limitado", async () => {
    for (let i = 0; i < 6; i++) expect((await attempt(env, `192.0.2.${i + 1}`)).statusCode).toBe(401);
    const same: number[] = [];
    for (let i = 0; i < 5; i++) same.push((await attempt(env, "192.0.2.200")).statusCode);
    expect(same.slice(0, 3)).toEqual([401, 401, 401]);
    expect(same.slice(3).every((s) => s === 429)).toBe(true);
  });

  it("a auditoria passa a guardar o IP encaminhado", async () => {
    await attempt(env, "198.51.100.88");
    expect(failedLoginIps()).toContain("198.51.100.88");
  });
});
