import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember, call, decisionBody, diagnose, goodQuote, loginOk, onboard, orderDetail, orderInDiagnosis, resetData,
  sendQuote, startTestEnv, transition, type Account, type Session, type TestEnv,
} from "./helpers.js";

let env: TestEnv;
let now: Date;
let a: Account;
let ownerA: Session;
let ownerB: Session;

beforeAll(async () => {
  env = await startTestEnv({}, () => now);
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  now = new Date("2026-11-03T12:00:00Z");
  await resetData(env.migrator);
  a = await onboard(env, "orcA");
  const b = await onboard(env, "orcB");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

const quoteOf = async (orderId: string, session = ownerA) =>
  (await orderDetail(env, session, orderId)).quotes as Array<{ id: string; state: string; number: number; totalCents: number; revision: number; items: unknown[]; decision: { decision: string; channel: string } | null }>;
const eventsOf = async (orderId: string) => (await orderDetail(env, ownerA, orderId)).events as Array<{ type: string; actorUserId: string | null; toState: string | null }>;

describe("decisão presencial", () => {
  const ready = async () => {
    const order = await orderInDiagnosis(env, ownerA);
    await diagnose(env, order.techSession, order.orderId);
    const sent = await sendQuote(env, ownerA, order.orderId);
    return { ...order, sent };
  };

  it("aprovar: grava a decisão presencial vinculada à versão e leva a OS para EM_REPARO", async () => {
    const { orderId, sent } = await ready();
    const res = await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody({ note: "Aprovou no balcão" }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ decision: "aprovado", orderState: "EM_REPARO" });
    const [quote] = await quoteOf(orderId);
    expect(quote).toMatchObject({ state: "aprovado", decision: { decision: "aprovado", channel: "presencial" } });
    const last = (await eventsOf(orderId)).at(-1);
    expect(last).toMatchObject({ type: "orcamento_aprovado", toState: "EM_REPARO" });
    expect(last?.actorUserId).toBeTruthy();
  });

  it("peça indisponível leva para AGUARDANDO_PECA; depois a peça chega e a OS segue para o reparo", async () => {
    const { orderId, sent } = await ready();
    expect((await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody({ partUnavailable: true }))).json().orderState).toBe("AGUARDANDO_PECA");
    expect((await transition(env, ownerA, orderId, "peca_disponivel")).json().state).toBe("EM_REPARO");
  });

  it("recusar leva para PRONTA_RETIRADA_SEM_REPARO; reabrir permite novo orçamento", async () => {
    const { orderId, sent } = await ready();
    const refused = await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody({ decision: "recusado", note: "Achou caro" }));
    expect(refused.json().orderState).toBe("PRONTA_RETIRADA_SEM_REPARO");
    expect((await transition(env, ownerA, orderId, "reabrir_diagnostico", "Cliente voltou")).json().state).toBe("EM_DIAGNOSTICO");
    const second = await call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, goodQuote());
    expect(second.statusCode).toBe(201);
    expect(second.json().number).toBe(2);
  });

  it("novo defeito no reparo volta ao diagnóstico e exige um novo orçamento; o aprovado fica preservado", async () => {
    const { orderId, sent } = await ready();
    await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody());
    const noReason = await transition(env, ownerA, orderId, "novo_defeito");
    expect(noReason.json().error.code).toBe("MOTIVO_OBRIGATORIO");
    expect((await transition(env, ownerA, orderId, "novo_defeito", "Placa também apresenta curto")).json().state).toBe("EM_DIAGNOSTICO");
    const second = await call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, goodQuote());
    expect(second.statusCode).toBe(201);
    expect(second.json().number).toBe(2);
    const quotes = await quoteOf(orderId);
    expect(quotes.map((q) => [q.number, q.state])).toEqual([[2, "rascunho"], [1, "aprovado"]]);
    expect(quotes[1]?.decision?.decision).toBe("aprovado");
  });

  it("peça indisponível junto com recusa é rejeitado", async () => {
    const { sent } = await ready();
    expect((await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody({ decision: "recusado", partUnavailable: true }))).statusCode).toBe(400);
  });

  it("idempotente: repetir a mesma decisão devolve 200 sem repetir a transição; decisão oposta dá 409", async () => {
    const { orderId, sent } = await ready();
    const first = await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody());
    const again = await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody());
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.headers["idempotent-replay"]).toBe("true");
    expect((await eventsOf(orderId)).filter((e) => e.type === "orcamento_aprovado")).toHaveLength(1);
    const conflict = await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody({ decision: "recusado" }));
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("DECISAO_CONFLITANTE");
  });

  it("aprovar e recusar ao mesmo tempo: exatamente uma decisão vale", async () => {
    const { orderId, sent } = await ready();
    const [x, y] = await Promise.all([
      call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody()),
      call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody({ decision: "recusado" })),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([201, 409]);
    expect((await quoteOf(orderId)).filter((q) => q.decision).length).toBe(1);
  });

  it("papéis: atendente decide; técnico não; outra empresa recebe 404", async () => {
    const { orderId, techSession, sent } = await ready();
    expect((await call(env, techSession, "POST", `/quotes/${sent.id}/decision`, decisionBody())).statusCode).toBe(403);
    expect((await call(env, ownerB, "POST", `/quotes/${sent.id}/decision`, decisionBody())).statusCode).toBe(404);
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    expect((await call(env, clerk, "POST", `/quotes/${sent.id}/decision`, decisionBody())).statusCode).toBe(201);
    expect((await orderDetail(env, ownerA, orderId)).state).toBe("EM_REPARO");
  });

  it("exige o nome de quem decidiu", async () => {
    const { sent } = await ready();
    expect((await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, { decision: "aprovado" })).statusCode).toBe(400);
    expect((await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody({ channel: "remoto" }))).statusCode).toBe(400);
  });
});

describe("validade e expiração", () => {
  const sentOrder = async () => {
    const order = await orderInDiagnosis(env, ownerA);
    await diagnose(env, order.techSession, order.orderId);
    return { ...order, sent: await sendQuote(env, ownerA, order.orderId) };
  };

  it("decidir depois do vencimento: 422, e a expiração fica gravada (não é desfeita pelo erro)", async () => {
    const { orderId, sent } = await sentOrder();
    now = new Date("2026-11-10T12:00:01Z");
    const res = await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody());
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("ORCAMENTO_EXPIRADO");
    const [quote] = await quoteOf(orderId);
    expect(quote).toMatchObject({ state: "expirado", decision: null });
    const detail = await orderDetail(env, ownerA, orderId);
    expect(detail.state).toBe("PRONTA_RETIRADA_SEM_REPARO");
    expect(detail.events.at(-1)).toMatchObject({ type: "orcamento_expirado", actorUserId: null });
  });

  it("no instante exato do vencimento já está vencido; um segundo antes ainda vale", async () => {
    const { sent } = await sentOrder();
    now = new Date("2026-11-10T11:59:59Z");
    expect((await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody())).statusCode).toBe(201);
  });

  it("varredura da empresa expira os vencidos, ignora os vigentes e não atribui o evento a ninguém", async () => {
    const overdue = await sentOrder();
    now = new Date("2026-11-09T12:00:00Z");
    const fresh = await sentOrder();
    now = new Date("2026-11-10T12:30:00Z");
    const sweep = await call(env, ownerA, "POST", "/quotes/expire-due", {});
    expect(sweep.json()).toEqual({ expired: 1, failed: 0 });
    expect((await quoteOf(overdue.orderId))[0]?.state).toBe("expirado");
    expect((await quoteOf(fresh.orderId))[0]?.state).toBe("enviado");
    expect((await eventsOf(overdue.orderId)).at(-1)).toMatchObject({ type: "orcamento_expirado", actorUserId: null });
    expect((await call(env, ownerA, "POST", "/quotes/expire-due", {})).json()).toEqual({ expired: 0, failed: 0 });
  });

  it("varredura exige permissão e só toca a própria empresa", async () => {
    const mine = await sentOrder();
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    const tech = await loginOk(env, (await addMember(env, ownerA, "tecnico")).email);
    now = new Date("2026-12-01T00:00:00Z");
    expect((await call(env, tech, "POST", "/quotes/expire-due", {})).statusCode).toBe(403);
    expect((await call(env, ownerB, "POST", "/quotes/expire-due", {})).json()).toEqual({ expired: 0, failed: 0 });
    expect((await quoteOf(mine.orderId))[0]?.state).toBe("enviado");
    expect((await call(env, clerk, "POST", "/quotes/expire-due", {})).json().expired).toBe(1);
  });
});

describe("isolamento", () => {
  it("B não vê, edita, envia, revisa nem decide orçamento de A (404 igual ao inexistente)", async () => {
    const { orderId, techSession } = await orderInDiagnosis(env, ownerA);
    await diagnose(env, techSession, orderId);
    const sent = await sendQuote(env, ownerA, orderId);
    const missing = "00000000-0000-4000-8000-000000000000";
    const attempts = [
      call(env, ownerB, "GET", `/work-orders/${orderId}/quotes`),
      call(env, ownerB, "PUT", `/quotes/${sent.id}`, { ...goodQuote(), revision: 1 }),
      call(env, ownerB, "POST", `/quotes/${sent.id}/submit`, { revision: 1 }),
      call(env, ownerB, "POST", `/quotes/${sent.id}/revise`, {}),
      call(env, ownerB, "POST", `/quotes/${sent.id}/decision`, decisionBody()),
    ];
    for (const res of await Promise.all(attempts)) expect(res.statusCode).toBe(404);
    const nothing = await call(env, ownerB, "POST", `/quotes/${missing}/decision`, decisionBody());
    expect(nothing.statusCode).toBe(404);
    expect((await quoteOf(orderId))[0]?.state).toBe("enviado");
  });

  it("técnico de outra OS não lê o orçamento", async () => {
    const { orderId } = await orderInDiagnosis(env, ownerA);
    const stranger = await loginOk(env, (await addMember(env, ownerA, "tecnico", "alheio")).email);
    expect((await call(env, stranger, "GET", `/work-orders/${orderId}/quotes`)).statusCode).toBe(404);
  });
});
