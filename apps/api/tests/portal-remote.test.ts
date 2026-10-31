import { createHmac, randomUUID } from "node:crypto";
import { schema, withContext } from "@reparo360/database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  call, loginOk, onboard, orderDetail, orderInDiagnosis, diagnose, sendQuote, portalLink, portalRead, resetData, startTestEnv,
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
const stateOf = async (orderId: string) => (await orderDetail(env, ownerA, orderId)).state;
const advance = (ms: number) => { now = new Date(now.getTime() + ms); };

describe("disponibilidade (falha fechada)", () => {
  it("SMTP_URL sem VERIFICATION_SECRET ou sem MAIL_FROM não carrega a configuração", () => {
    const base = { DATABASE_URL: "postgres://x", STORAGE_DIR: "/tmp/x" };
    expect(() => loadConfig({ ...base, SMTP_URL: "smtp://localhost:25", MAIL_FROM: "a@b.invalid" })).toThrow();
    expect(() => loadConfig({ ...base, SMTP_URL: "smtp://localhost:25", VERIFICATION_SECRET: SECRET })).toThrow();
    expect(() => loadConfig({ ...base, SMTP_URL: "smtp://localhost:25", MAIL_FROM: "a@b.invalid", VERIFICATION_SECRET: SECRET })).toThrow(); // falta PUBLIC_URL
    expect(() => loadConfig({ ...base, SMTP_URL: "smtp://localhost:25", MAIL_FROM: "a@b.invalid", VERIFICATION_SECRET: SECRET, PUBLIC_URL })).not.toThrow();
    expect(() => loadConfig({ ...base })).not.toThrow();
  });

  it("sem envio de e-mail configurado, o portal só orienta e o pedido de código é recusado", async () => {
    const off = await startTestEnv({}, () => now);
    try {
      const acc = await onboard(off, "semEmail");
      const owner = await loginOk(off, acc.email);
      const order = await orderInDiagnosis(off, owner);
      await diagnose(off, order.techSession, order.orderId);
      await sendQuote(off, owner, order.orderId);
      await withContext(off.migrator, { tenantId: acc.tenantId }, (db) => db.update(schema.customers).set({ email: CUSTOMER_EMAIL }));
      const { token } = await portalLink(off, owner, order.orderId);
      expect((await portalRead(off, token)).json().canDecide).toBe(false);
      expect((await portalRequestCode(off, token)).statusCode).toBe(422);
      expect((await portalDecide(off, token, { decision: "aprovado", code: "123456" })).statusCode).toBe(422);
    } finally {
      await off.close();
    }
  });

  it("cliente sem e-mail cadastrado: nada a decidir à distância e nenhuma mensagem sai", async () => {
    const { token } = await awaitingApproval(null);
    expect((await portalRead(env, token)).json().canDecide).toBe(false);
    expect((await portalRequestCode(env, token)).statusCode).toBe(422);
    expect(mailer.outbox).toHaveLength(0);
  });

  it("com e-mail e orçamento vigente, o portal oferece a decisão e mostra só o e-mail mascarado", async () => {
    const { token } = await awaitingApproval();
    const view = (await portalRead(env, token)).json();
    expect(view.canDecide).toBe(true);
    expect(view.emailHint).toBe("m***@teste.invalid");
    expect(JSON.stringify(view)).not.toContain(CUSTOMER_EMAIL);
  });
});

describe("caminho feliz", () => {
  it("envia o código ao e-mail cadastrado e a decisão fica gravada como remota, sem autor da equipe", async () => {
    const { orderId, quote, token } = await awaitingApproval();
    const requested = await portalRequestCode(env, token);
    expect(requested.statusCode).toBe(202);
    expect(requested.body).not.toMatch(/\d{6}/);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0]?.to).toBe(CUSTOMER_EMAIL);
    const code = mailer.lastCode();

    const decided = await portalDecide(env, token, { decision: "aprovado", code });
    expect(decided.statusCode).toBe(200);
    expect(await stateOf(orderId)).toBe("EM_REPARO");

    const decisions = await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.select().from(schema.quoteDecisions));
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ quoteVersionId: quote.id, decision: "aprovado", channel: "remoto", decidedBy: null, confirmedByName: "Maria Teste" });
    expect(decisions[0]?.verificationId).toBeTruthy();

    const events = await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.select().from(schema.workOrderEvents).where(eq(schema.workOrderEvents.type, "orcamento_aprovado")));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ origin: "cliente", actorUserId: null });

    // O banco guarda só o HMAC do código, nunca o código.
    const rows = await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.select().from(schema.customerVerifications));
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(rows[0]?.consumedAt).toBeTruthy();
  });

  it("recusar também funciona e leva a OS para retirada sem reparo", async () => {
    const { orderId, token } = await awaitingApproval();
    await portalRequestCode(env, token);
    expect((await portalDecide(env, token, { decision: "recusado", code: mailer.lastCode() })).statusCode).toBe(200);
    expect(await stateOf(orderId)).toBe("PRONTA_RETIRADA_SEM_REPARO");
  });

  it("o código vale uma vez: repetir a decisão com o mesmo código é recusado", async () => {
    const { orderId, token } = await awaitingApproval();
    await portalRequestCode(env, token);
    const code = mailer.lastCode();
    expect((await portalDecide(env, token, { decision: "aprovado", code })).statusCode).toBe(200);
    expect((await portalDecide(env, token, { decision: "aprovado", code })).statusCode).toBe(422);
    expect((await portalDecide(env, token, { decision: "recusado", code })).statusCode).toBe(422);
    expect(await stateOf(orderId)).toBe("EM_REPARO");
  });

  it("o PDF do registro de decisão diz que foi remota", async () => {
    const { quote, token } = await awaitingApproval();
    await portalRequestCode(env, token);
    await portalDecide(env, token, { decision: "aprovado", code: mailer.lastCode() });
    const res = await call(env, ownerA, "GET", `/quotes/${quote.id}/approval-record`);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("tentativas, validade e substituição de código", () => {
  it("5 erros esgotam o código: o certo depois disso também é recusado e a OS não muda", async () => {
    const { orderId, token } = await awaitingApproval();
    await portalRequestCode(env, token);
    const right = mailer.lastCode();
    const wrong = right === "000000" ? "111111" : "000000";
    const lefts: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await portalDecide(env, token, { decision: "aprovado", code: wrong });
      expect(res.statusCode).toBe(422);
      lefts.push(res.json().error.details?.attemptsLeft);
    }
    expect(lefts).toEqual([4, 3, 2, 1, 0]);
    const locked = await portalDecide(env, token, { decision: "aprovado", code: right });
    expect(locked.statusCode).toBe(429);
    expect(await stateOf(orderId)).toBe("AGUARDANDO_APROVACAO");
  });

  it("o contador de erros é gravado no banco (não some quando a resposta é um erro)", async () => {
    const { token } = await awaitingApproval();
    await portalRequestCode(env, token);
    await portalDecide(env, token, { decision: "aprovado", code: "000000" === mailer.lastCode() ? "111111" : "000000" });
    const rows = await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.select().from(schema.customerVerifications));
    expect(rows[0]?.attempts).toBe(1);
  });

  it("código vencido (10 min) é recusado", async () => {
    const { orderId, token } = await awaitingApproval();
    await portalRequestCode(env, token);
    const code = mailer.lastCode();
    advance(10 * 60 * 1000 + 1000);
    expect((await portalDecide(env, token, { decision: "aprovado", code })).statusCode).toBe(422);
    expect(await stateOf(orderId)).toBe("AGUARDANDO_APROVACAO");
  });

  it("pedir um novo código invalida o anterior", async () => {
    const { orderId, token } = await awaitingApproval();
    await portalRequestCode(env, token);
    const first = mailer.lastCode();
    advance(61 * 1000);
    expect((await portalRequestCode(env, token)).statusCode).toBe(202);
    const second = mailer.lastCode();
    if (first !== second) expect((await portalDecide(env, token, { decision: "aprovado", code: first })).statusCode).toBe(422);
    expect((await portalDecide(env, token, { decision: "aprovado", code: second })).statusCode).toBe(200);
    expect(await stateOf(orderId)).toBe("EM_REPARO");
  });

  it("limita o pedido de códigos: 1 por minuto e 5 por hora", async () => {
    const { token } = await awaitingApproval();
    expect((await portalRequestCode(env, token)).statusCode).toBe(202);
    expect((await portalRequestCode(env, token)).statusCode).toBe(429);
    for (let i = 0; i < 4; i++) {
      advance(61 * 1000);
      expect((await portalRequestCode(env, token)).statusCode, `pedido ${i + 2}`).toBe(202);
    }
    advance(61 * 1000);
    expect((await portalRequestCode(env, token)).statusCode).toBe(429);
    expect(mailer.outbox).toHaveLength(5);
  });
});

describe("o que muda depois de o código ser emitido", () => {
  it("link revogado entre o pedido e a decisão: 404 e a OS não muda", async () => {
    const { orderId, token } = await awaitingApproval();
    await portalRequestCode(env, token);
    const code = mailer.lastCode();
    expect((await call(env, ownerA, "DELETE", `/work-orders/${orderId}/portal-link`)).statusCode).toBe(204);
    expect((await portalDecide(env, token, { decision: "aprovado", code })).statusCode).toBe(404);
    expect(await stateOf(orderId)).toBe("AGUARDANDO_APROVACAO");
  });

  it("orçamento revisado depois do código: o código antigo não aprova a versão nova", async () => {
    const { orderId, quote, token } = await awaitingApproval();
    await portalRequestCode(env, token);
    const code = mailer.lastCode();
    const revised = await call(env, ownerA, "POST", `/quotes/${quote.id}/revise`, {});
    expect(revised.statusCode).toBe(201);
    const res = await portalDecide(env, token, { decision: "aprovado", code });
    expect([409, 422]).toContain(res.statusCode);
    expect(await stateOf(orderId)).not.toBe("EM_REPARO");
  });

  it("decisão presencial já feita: o código emitido antes não decide de novo", async () => {
    const { orderId, quote, token } = await awaitingApproval();
    await portalRequestCode(env, token);
    const code = mailer.lastCode();
    const staff = await call(env, ownerA, "POST", `/quotes/${quote.id}/decision`, { decision: "recusado", confirmedByName: "Maria Teste" });
    expect(staff.statusCode).toBe(201);
    expect((await portalDecide(env, token, { decision: "aprovado", code })).statusCode).toBe(409);
    expect(await stateOf(orderId)).toBe("PRONTA_RETIRADA_SEM_REPARO");
  });

  it("validade do orçamento vencida: a decisão é recusada e a expiração fica gravada", async () => {
    const { orderId, quote, token } = await awaitingApproval();
    // A validade do orçamento (dias) é maior que a do código (minutos): para chegar a este caminho, o desafio
    // é gravado direto no banco com validade longa, usando o mesmo HMAC da API.
    const grants = await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.select().from(schema.customerAccessGrants));
    const id = randomUUID();
    const code = "424242";
    await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.insert(schema.customerVerifications).values({
      id, tenantId: a.tenantId, grantId: grants[0]!.id, quoteVersionId: quote.id,
      codeHash: createHmac("sha256", SECRET).update(`${id}:${code}`).digest("hex"), expiresAt: new Date("2027-01-01T00:00:00Z"), createdAt: now,
    }));
    now = new Date(new Date(quote.validUntil).getTime() + 1000);
    const res = await portalDecide(env, token, { decision: "aprovado", code });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("ORCAMENTO_EXPIRADO");
    expect(await stateOf(orderId)).not.toBe("EM_REPARO");
    const row = await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.select().from(schema.quoteVersions).where(eq(schema.quoteVersions.id, quote.id)));
    expect(row[0]?.state).toBe("expirado");
  });
});
