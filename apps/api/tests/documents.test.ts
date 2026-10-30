import { schema, withContext } from "@reparo360/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addMember, call, inspectionPayload, loginOk, newCustomer, newDevice, onboard, openOrder, resetData, setupOrder, startTestEnv, type Account, type Session, type TestEnv } from "./helpers.js";
import { pdfText } from "./pdf.js";

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
  a = await onboard(env, "docsA");
  const b = await onboard(env, "docsB");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

describe("comprovante de recebimento (PDF)", () => {
  it("gera um PDF real com os dados do recebimento e sem a senha do aparelho", async () => {
    const customerId = await newCustomer(env, ownerA, "Maria da Conceição", "(85) 99999-1234");
    const deviceId = await newDevice(env, ownerA, customerId, { brand: "Samsung", model: "Galaxy A54" });
    const opened = await openOrder(env, ownerA, customerId, deviceId, {
      reportedDefect: "Não carrega depois da queda",
      inspection: inspectionPayload({ passwordInformed: true, accessories: ["carregador", "capa"] }),
    });
    const { id, protocol } = opened.json<{ id: string; protocol: string }>();

    const res = await call(env, ownerA, "GET", `/work-orders/${id}/documents/receipt`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="comprovante-${protocol}.pdf"`);
    const pdf = res.rawPayload;
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Title e Subject são objetos indiretos do dicionário Info, gravados como texto puro.
    const raw = pdf.toString("latin1");
    expect(raw).toContain(`(Comprovante de recebimento ${protocol})`);
    expect(raw).toContain(`\n(${protocol})\n`);

    const text = pdfText(pdf);
    for (const expected of [
      `Assistência docsA`,
      "Comprovante de recebimento",
      protocol,
      "Maria da Conceição",
      "(85) 99999-1234",
      "Samsung Galaxy A54",
      "Não carrega depois da queda",
      "Tela trincada",
      "carregador, capa",
      "Senha do aparelho informada: sim",
      "Tela: Com defeito",
      "Câmera: Não testado",
      "não é documento fiscal",
    ]) {
      expect(text, expected).toContain(expected);
    }
  });

  it("não quebra com caracteres fora do WinAnsi: acentos saem certos, o resto vira '?'", async () => {
    const customerId = await newCustomer(env, ownerA, "Zoë Ação 😀 Дмитрий", "85988887777");
    const deviceId = await newDevice(env, ownerA, customerId);
    const { id } = (await openOrder(env, ownerA, customerId, deviceId)).json<{ id: string }>();
    const res = await call(env, ownerA, "GET", `/work-orders/${id}/documents/receipt`);
    expect(res.statusCode).toBe(200);
    const text = pdfText(res.rawPayload);
    expect(text).toContain("Zoë Ação ? ??????");
  });

  it("registra a emissão na auditoria", async () => {
    const { orderId } = await setupOrder(env, ownerA);
    await call(env, ownerA, "GET", `/work-orders/${orderId}/documents/receipt`);
    // audit_events está sob FORCE RLS: até o migrador só lê informando o contexto do tenant.
    const events = await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.select().from(schema.auditEvents));
    expect(events.some((e) => e.action === "document_receipt_generated" && e.targetId === orderId)).toBe(true);
  });

  it("técnico não emite o comprovante (contém dados de contato); outra empresa recebe 404; sem sessão, 401", async () => {
    const tech = await addMember(env, ownerA, "tecnico");
    const techSession = await loginOk(env, tech.email);
    const { orderId } = await setupOrder(env, ownerA, { technicianId: tech.userId });
    expect((await call(env, techSession, "GET", `/work-orders/${orderId}/documents/receipt`)).statusCode).toBe(403);
    expect((await call(env, ownerB, "GET", `/work-orders/${orderId}/documents/receipt`)).statusCode).toBe(404);
    expect((await call(env, null, "GET", `/work-orders/${orderId}/documents/receipt`)).statusCode).toBe(401);
  });
});
