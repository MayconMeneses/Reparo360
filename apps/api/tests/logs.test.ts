import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, loginOk, newCustomer, newDevice, onboard, resetData, startTestEnv, type Session, type TestEnv } from "./helpers.js";

let env: TestEnv;
let owner: Session;
const lines: string[] = [];

beforeAll(async () => {
  env = await startTestEnv({ LOG_LEVEL: "info" }, undefined, { write: (chunk: string) => void lines.push(chunk) });
  await resetData(env.migrator);
  owner = await loginOk(env, (await onboard(env, "logs")).email);
});
afterAll(async () => {
  await env.close();
});

/** Spec 26.1: logs não carregam dados pessoais. A busca por nome, telefone ou IMEI vai na query string da URL. */
describe("logs sem dados pessoais", () => {
  it("a query string (busca por nome, telefone, IMEI, protocolo) não aparece no log", async () => {
    const customerId = await newCustomer(env, owner, "Fulana Sigilosa de Tal", "(85) 98765-4321");
    await newDevice(env, owner, customerId, { imei: "490154203237518", serialNumber: "SERIE-SECRETA-123" });
    lines.length = 0;
    await call(env, owner, "GET", `/customers?q=${encodeURIComponent("Fulana Sigilosa")}`);
    await call(env, owner, "GET", "/customers?q=85987654321");
    await call(env, owner, "GET", "/devices?q=490154203237518");
    await call(env, owner, "GET", `/devices?q=${encodeURIComponent("SERIE-SECRETA")}`);
    await call(env, owner, "GET", "/work-orders?q=2026-000123");
    const logs = lines.join("");
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of ["Fulana", "Sigilosa", "85987654321", "490154203237518", "SERIE-SECRETA", "2026-000123"]) {
      expect(logs, `vazou no log: ${secret}`).not.toContain(secret);
    }
    // O log continua útil: registra a rota, sem a query.
    expect(logs).toContain("/api/v1/customers");
    expect(logs).toContain("/api/v1/devices");
  });

  it("corpos de requisição (senha, e-mail, telefone) e cookies nunca entram no log", async () => {
    lines.length = 0;
    await call(env, owner, "POST", "/customers", { name: "Corpo Sigiloso", phone: "(85) 97777-1111", email: "corpo.sigiloso@teste.invalid", confirmDuplicate: true });
    await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: "alguem@teste.invalid", password: "SenhaQueNaoDeveVazar-9" } });
    const logs = lines.join("");
    for (const secret of ["Corpo Sigiloso", "85977771111", "corpo.sigiloso", "SenhaQueNaoDeveVazar", "alguem@teste.invalid", owner.csrf, owner.cookie.split("=")[1] ?? "x"]) {
      expect(logs, `vazou no log: ${secret}`).not.toContain(secret);
    }
  });

  it("erro interno registra o código e o ID de correlação, sem a requisição completa", async () => {
    lines.length = 0;
    const res = await env.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: "__Host-r360_session=token-invalido", "user-agent": "Teste/1.0" } });
    expect(res.statusCode).toBe(401);
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(lines.join("")).not.toContain("token-invalido");
  });
});
