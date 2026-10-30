import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember, call, deliver, diagnose, loginOk, onboard, orderInDiagnosis, orderReadyForPickup, resetData, sendQuote, startTestEnv,
  type Account, type Session, type TestEnv,
} from "./helpers.js";
import { pdfText } from "./pdf.js";

let env: TestEnv;
let now: Date;
let a: Account;
let ownerA: Session;
let ownerB: Session;
const PHONE_MASKED = "(85) 99999-1234";

beforeAll(async () => {
  env = await startTestEnv({}, () => now);
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  now = new Date("2026-11-03T12:00:00Z");
  await resetData(env.migrator);
  a = await onboard(env, "docsF");
  const b = await onboard(env, "docsG");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

const pdf = async (session: Session | null, url: string) => {
  const res = await call(env, session, "GET", url);
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  expect(res.headers["content-type"]).toBe("application/pdf");
  expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  return { text: pdfText(res.rawPayload), raw: res.rawPayload.toString("latin1"), res };
};

describe("orçamento em PDF", () => {
  it("traz itens, valores em reais a partir dos centavos, validade e condições; sem telefone do cliente", async () => {
    const { sent, protocol } = await orderReadyForPickup(env, ownerA);
    const { text, raw, res } = await pdf(ownerA, `/quotes/${sent.id}/document`);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="orcamento-${protocol}-v1.pdf"`);
    // Title tem acento (gravado em UTF-16); o Subject é o protocolo em texto puro.
    expect(raw).toContain(`\n(${protocol})\n`);
    for (const expected of [
      "Orçamento (versão 1)", protocol, "Aprovado", "Peça: Bateria  |  1 x R$ 150,00 = R$ 150,00", "Serviço: Mão de obra  |  2 x R$ 45,90 = R$ 91,80",
      "Subtotal: R$ 241,80", "Total: R$ 241,80", "Válido até", "À vista ou cartão em até 3x", "3 dia(s)", "não é documento fiscal", "não registra pagamento",
    ]) expect(text, expected).toContain(expected);
    expect(text).not.toContain(PHONE_MASKED);
  });

  it("rascunho não gera documento", async () => {
    const { orderId, techSession } = await orderInDiagnosis(env, ownerA);
    await diagnose(env, techSession, orderId);
    const draft = (await call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, { items: [{ kind: "servico", description: "Serviço", quantity: 1, unitPriceCents: 100 }] })).json();
    const res = await call(env, ownerA, "GET", `/quotes/${draft.id}/document`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("ORCAMENTO_EM_RASCUNHO");
  });

  it("versão substituída e versão expirada saem marcadas e não passam pela vigente", async () => {
    const replaced = await orderInDiagnosis(env, ownerA);
    await diagnose(env, replaced.techSession, replaced.orderId);
    const first = await sendQuote(env, ownerA, replaced.orderId);
    await call(env, ownerA, "POST", `/quotes/${first.id}/revise`, {});
    expect((await pdf(ownerA, `/quotes/${first.id}/document`)).text).toContain("VERSÃO SUBSTITUÍDA");

    const overdue = await orderInDiagnosis(env, ownerA);
    await diagnose(env, overdue.techSession, overdue.orderId);
    const stale = await sendQuote(env, ownerA, overdue.orderId);
    now = new Date("2026-11-20T12:00:00Z");
    await call(env, ownerA, "POST", "/quotes/expire-due", {});
    expect((await pdf(ownerA, `/quotes/${stale.id}/document`)).text).toContain("ORÇAMENTO EXPIRADO");
  });
});

describe("registro de decisão em PDF", () => {
  it("diz que foi presencial e quem decidiu, e nunca sugere decisão remota", async () => {
    const { sent, protocol } = await orderReadyForPickup(env, ownerA);
    const { text, raw } = await pdf(ownerA, `/quotes/${sent.id}/approval-record`);
    expect(raw).toContain(`(${protocol})`);
    for (const expected of ["Registro de decisão sobre orçamento", "APROVADO", "Presencial, registrada por funcionário da assistência", "Decisão informada por: Maria Teste", "versão 1, total R$ 241,80"]) {
      expect(text, expected).toContain(expected);
    }
    expect(text.toLowerCase()).not.toContain("remot");
    expect(text).not.toContain(PHONE_MASKED);
  });

  it("sem decisão registrada: 422", async () => {
    const { orderId, techSession } = await orderInDiagnosis(env, ownerA);
    await diagnose(env, techSession, orderId);
    const sent = await sendQuote(env, ownerA, orderId);
    const res = await call(env, ownerA, "GET", `/quotes/${sent.id}/approval-record`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("SEM_DECISAO");
  });
});

describe("comprovante de entrega em PDF", () => {
  it("registra a retirada e deixa claro que não é pagamento nem documento fiscal", async () => {
    const { orderId, protocol } = await orderReadyForPickup(env, ownerA);
    expect((await call(env, ownerA, "GET", `/work-orders/${orderId}/documents/delivery`)).json().error.code).toBe("SEM_ENTREGA");
    await deliver(env, ownerA, orderId, { pickedUpByName: "João Conceição" });
    const { text, raw } = await pdf(ownerA, `/work-orders/${orderId}/documents/delivery`);
    expect(raw).toContain(`(${protocol})`);
    for (const expected of ["Comprovante de entrega", "Retirado por: João Conceição", "Comprovante de recebimento apresentado", "Acessórios devolvidos: carregador", "não registra pagamento nem quitação", "não é documento fiscal"]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).not.toContain(PHONE_MASKED);
  });
});

describe("ordem de serviço em PDF", () => {
  it("resume recebimento, diagnóstico, orçamento, reparo, testes e histórico", async () => {
    const { orderId, protocol } = await orderReadyForPickup(env, ownerA);
    await deliver(env, ownerA, orderId);
    const { text } = await pdf(ownerA, `/work-orders/${orderId}/documents/sheet`);
    for (const expected of [
      "Ordem de serviço", protocol, "ENTREGUE", PHONE_MASKED, "Tela trincada no canto superior.", "Bateria viciada",
      "Versão 1 (Aprovado): R$ 241,80", "Troca de bateria e limpeza dos contatos", "Carga: Aprovado", "Câmera: Não se aplica",
      "os_aberta", "orcamento_aprovado", "testes_aprovados", "entregue",
    ]) expect(text, expected).toContain(expected);
  });
});

describe("acesso aos documentos", () => {
  it("técnico não emite nenhum; outra empresa recebe 404; sem sessão, 401", async () => {
    const order = await orderReadyForPickup(env, ownerA);
    await deliver(env, ownerA, order.orderId);
    const urls = [
      `/work-orders/${order.orderId}/documents/sheet`,
      `/work-orders/${order.orderId}/documents/delivery`,
      `/work-orders/${order.orderId}/documents/receipt`,
      `/quotes/${order.sent.id}/document`,
      `/quotes/${order.sent.id}/approval-record`,
    ];
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    for (const url of urls) {
      expect((await call(env, order.techSession, "GET", url)).statusCode, `técnico ${url}`).toBe(403);
      expect((await call(env, ownerB, "GET", url)).statusCode, `outra empresa ${url}`).toBe(404);
      expect((await call(env, null, "GET", url)).statusCode, `anônimo ${url}`).toBe(401);
      expect((await call(env, clerk, "GET", url)).statusCode, `atendente ${url}`).toBe(200);
    }
  });
});
