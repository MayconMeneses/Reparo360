import { schema, withContext } from "@reparo360/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  loginOk, onboard, orderDetail, portalRead, resetData, startTestEnv,
  type Account, type Session, type TestEnv,
} from "./helpers.js";
import { awaitingApproval as awaiting, CUSTOMER_EMAIL, MemoryMailer, portalDecide, portalRequestCode, PUBLIC_URL, SECRET } from "./remote-helpers.js";

let env: TestEnv;
let mailer: MemoryMailer;
let now: Date;
let a: Account;
let ownerA: Session;
const logLines: string[] = [];

beforeAll(async () => {
  mailer = new MemoryMailer();
  env = await startTestEnv({ LOG_LEVEL: "info", VERIFICATION_SECRET: SECRET, PUBLIC_URL: PUBLIC_URL, PORTAL_RATE_LIMIT_MAX: "1000" }, () => now, { write: (chunk: string) => void logLines.push(chunk) }, mailer);
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  now = new Date("2026-11-03T12:00:00Z");
  logLines.length = 0;
  mailer.outbox.length = 0;
  mailer.failNext = false;
  await resetData(env.migrator);
  a = await onboard(env, "remotoA");
  ownerA = await loginOk(env, a.email);
});


const awaitingApproval = (email: string | null = CUSTOMER_EMAIL) => awaiting(env, ownerA, a, email);

describe("abuso", () => {
  it("duas decisões opostas ao mesmo tempo com o mesmo código: exatamente uma vale (8 rodadas)", async () => {
    for (let round = 0; round < 8; round++) {
      const { orderId, token } = await awaitingApproval();
      await portalRequestCode(env, token);
      const code = mailer.lastCode();
      const results = await Promise.all([
        portalDecide(env, token, { decision: "aprovado", code }),
        portalDecide(env, token, { decision: "recusado", code }),
      ]);
      expect(results.map((r) => r.statusCode).filter((s) => s === 200), `rodada ${round}`).toHaveLength(1);
      const decisions = await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.select().from(schema.quoteDecisions));
      expect(decisions.filter((d) => d.channel === "remoto").length).toBeGreaterThanOrEqual(1);
      const events = (await orderDetail(env, ownerA, orderId)).events.filter((e: { type: string }) => e.type === "orcamento_aprovado" || e.type === "orcamento_recusado");
      expect(events, `rodada ${round}`).toHaveLength(1);
      await resetData(env.migrator);
      a = await onboard(env, `remotoA${round}`);
      ownerA = await loginOk(env, a.email);
    }
  });

  it("corpo estrito: campo extra (como peça indisponível), código mal formado e decisão inválida dão 400", async () => {
    const { token } = await awaitingApproval();
    await portalRequestCode(env, token);
    const code = mailer.lastCode();
    for (const payload of [
      { decision: "aprovado", code, partUnavailable: true },
      { decision: "aprovado", code: "12345" },
      { decision: "aprovado", code: "abcdef" },
      { decision: "talvez", code },
      { decision: "aprovado" },
    ]) {
      expect((await portalDecide(env, token, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await portalRequestCode(env, token, { email: "outro@teste.invalid" })).statusCode).toBe(400);
  });

  it("token inválido: o mesmo 404 do restante do portal, sem mandar e-mail", async () => {
    await awaitingApproval();
    for (const bad of ["curto", "x".repeat(43)]) {
      expect((await portalRequestCode(env, bad)).statusCode).toBe(404);
      expect((await portalDecide(env, bad, { decision: "aprovado", code: "123456" })).statusCode).toBe(404);
    }
    expect(mailer.outbox).toHaveLength(0);
  });

  it("falha do provedor de e-mail: 503 genérico, e o código nunca aparece em resposta nem em log", async () => {
    const { token } = await awaitingApproval();
    mailer.failNext = true;
    const res = await portalRequestCode(env, token);
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toMatch(/\d{6}|@/);
    expect(logLines.join("")).not.toContain(CUSTOMER_EMAIL);
  });

  it("e-mail do cliente e código não aparecem nos logs do servidor", async () => {
    const { token } = await awaitingApproval();
    await portalRequestCode(env, token);
    const code = mailer.lastCode();
    await portalDecide(env, token, { decision: "aprovado", code: code === "000000" ? "111111" : "000000" });
    await portalDecide(env, token, { decision: "aprovado", code });
    const logs = logLines.join("");
    expect(logs).not.toContain(CUSTOMER_EMAIL);
    expect(logs).not.toContain(`"code":"${code}"`);
    expect(logs).not.toContain(token);
  });

  it("o histórico público mostra a aprovação como evento normal", async () => {
    const { token } = await awaitingApproval();
    await portalRequestCode(env, token);
    await portalDecide(env, token, { decision: "aprovado", code: mailer.lastCode() });
    const view = (await portalRead(env, token)).json();
    expect(view.timeline.map((t: { label: string }) => t.label)).toContain("Orçamento aprovado");
    expect(view.canDecide).toBe(false);
  });
});
