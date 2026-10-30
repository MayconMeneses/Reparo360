import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember, call, decisionBody, diagnose, goodDiagnostic, goodQuote, loginOk, onboard, orderDetail, orderInDiagnosis, resetData,
  sendQuote, setupOrder, startTestEnv, type Account, type Session, type TestEnv,
} from "./helpers.js";

let env: TestEnv;
let now: Date;
let a: Account;
let ownerA: Session;

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
  ownerA = await loginOk(env, a.email);
});

const quoteOf = async (orderId: string, session = ownerA) =>
  (await orderDetail(env, session, orderId)).quotes as Array<{ id: string; state: string; number: number; totalCents: number; revision: number; items: unknown[]; decision: { decision: string; channel: string } | null }>;

describe("diagnóstico", () => {
  it("só com a OS em diagnóstico; suspeita sem defeito é recusada; revisões são preservadas", async () => {
    const received = await setupOrder(env, ownerA);
    const early = await call(env, ownerA, "POST", `/work-orders/${received.orderId}/diagnostics`, goodDiagnostic());
    expect(early.statusCode).toBe(422);
    expect(early.json().error.code).toBe("OS_FORA_DE_DIAGNOSTICO");

    const { orderId, techSession } = await orderInDiagnosis(env, ownerA);
    expect((await call(env, techSession, "POST", `/work-orders/${orderId}/diagnostics`, goodDiagnostic({ nature: "suspeita", findings: undefined }))).statusCode).toBe(400);
    expect((await call(env, techSession, "POST", `/work-orders/${orderId}/diagnostics`, goodDiagnostic({ nature: "suspeita", findings: "Possível placa" }))).statusCode).toBe(201);
    expect((await call(env, techSession, "POST", `/work-orders/${orderId}/diagnostics`, goodDiagnostic({ nature: "inconclusivo", findings: undefined }))).statusCode).toBe(201);
    await diagnose(env, techSession, orderId);
    const list = (await orderDetail(env, ownerA, orderId)).diagnostics as Array<{ revision: number; nature: string }>;
    expect(list.map((d) => [d.revision, d.nature])).toEqual([[3, "confirmado"], [2, "inconclusivo"], [1, "suspeita"]]);
  });

  it("atendente não registra diagnóstico; técnico de outra OS recebe 404", async () => {
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    const { orderId } = await orderInDiagnosis(env, ownerA);
    expect((await call(env, clerk, "POST", `/work-orders/${orderId}/diagnostics`, goodDiagnostic())).statusCode).toBe(403);
    const stranger = await loginOk(env, (await addMember(env, ownerA, "tecnico", "estranho")).email);
    expect((await call(env, stranger, "POST", `/work-orders/${orderId}/diagnostics`, goodDiagnostic())).statusCode).toBe(404);
  });
});

describe("rascunho do orçamento", () => {
  it("calcula os totais no servidor em centavos e rejeita total enviado pelo cliente", async () => {
    const { orderId } = await orderInDiagnosis(env, ownerA);
    const res = await call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, goodQuote({ discountCents: 1000 }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ subtotalCents: 24180, discountCents: 1000, totalCents: 23180, state: "rascunho", number: 1 });
    for (const forged of [{ totalCents: 1 }, { subtotalCents: 1 }, { state: "aprovado" }, { validUntil: "2099-01-01" }]) {
      expect((await call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, { ...goodQuote(), ...forged })).statusCode, JSON.stringify(forged)).toBe(400);
    }
  });

  it("valida itens: quantidade, preço, desconto maior que o subtotal", async () => {
    const { orderId } = await orderInDiagnosis(env, ownerA);
    const post = (body: object) => call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, body);
    expect((await post(goodQuote({ items: [{ kind: "peca", description: "x1", quantity: 0, unitPriceCents: 100 }] }))).statusCode).toBe(400);
    expect((await post(goodQuote({ items: [{ kind: "peca", description: "x1", quantity: 1, unitPriceCents: -1 }] }))).statusCode).toBe(400);
    expect((await post(goodQuote({ items: [{ kind: "peca", description: "x1", quantity: 1, unitPriceCents: 9.99 }] }))).statusCode).toBe(400);
    const tooBig = await post(goodQuote({ discountCents: 99999999 }));
    expect(tooBig.statusCode).toBe(422);
  });

  it("limite de desconto por papel: atendente 0%, gerente até 10%, proprietário livre; técnico 0%", async () => {
    const { orderId, techSession } = await orderInDiagnosis(env, ownerA);
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    const manager = await loginOk(env, (await addMember(env, ownerA, "gerente")).email);
    const items = [{ kind: "servico", description: "Serviço", quantity: 1, unitPriceCents: 10000 }];
    const create = (s: Session, discountCents: number) => call(env, s, "POST", `/work-orders/${orderId}/quotes`, goodQuote({ items, discountCents }));
    const denied = await create(clerk, 1);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("DESCONTO_ACIMA_DO_LIMITE");
    expect((await create(techSession, 1)).statusCode).toBe(403);
    expect((await create(manager, 1001)).statusCode).toBe(403);
    const ok = await create(manager, 1000);
    expect(ok.statusCode).toBe(201);
    const id = ok.json().id as string;
    expect((await call(env, ownerA, "PUT", `/quotes/${id}`, { ...goodQuote({ items, discountCents: 10000 }), revision: ok.json().revision })).statusCode).toBe(200);
  });

  it("uma versão aberta por OS: segundo rascunho dá 409; editar exige a revisão atual", async () => {
    const { orderId } = await orderInDiagnosis(env, ownerA);
    const first = await call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, goodQuote());
    const second = await call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, goodQuote());
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("ORCAMENTO_EM_ABERTO");
    const { id, revision } = first.json();
    const edited = await call(env, ownerA, "PUT", `/quotes/${id}`, { ...goodQuote({ notes: "ajuste" }), revision });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().revision).toBe(revision + 1);
    const stale = await call(env, ownerA, "PUT", `/quotes/${id}`, { ...goodQuote({ notes: "outro" }), revision });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("CONFLITO_DE_VERSAO");
  });

  it("técnico monta rascunho da OS dele, mas não envia", async () => {
    const { orderId, techSession } = await orderInDiagnosis(env, ownerA);
    const created = await call(env, techSession, "POST", `/work-orders/${orderId}/quotes`, goodQuote());
    expect(created.statusCode).toBe(201);
    await diagnose(env, techSession, orderId);
    const submit = await call(env, techSession, "POST", `/quotes/${created.json().id}/submit`, { revision: created.json().revision });
    expect(submit.statusCode).toBe(403);
  });
});

describe("envio do orçamento", () => {
  it("exige diagnóstico, bloqueia inconclusivo e suspeita sem autorização explícita (P-09)", async () => {
    const { orderId, techSession } = await orderInDiagnosis(env, ownerA);
    const draft = (await call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, goodQuote())).json();
    const submit = (extra: object = {}) => call(env, ownerA, "POST", `/quotes/${draft.id}/submit`, { revision: draft.revision, ...extra });
    expect((await submit()).json().error.code).toBe("SEM_DIAGNOSTICO");
    await diagnose(env, techSession, orderId, { nature: "inconclusivo", findings: undefined });
    expect((await submit()).json().error.code).toBe("DIAGNOSTICO_INCONCLUSIVO");
    await diagnose(env, techSession, orderId, { nature: "suspeita", findings: "Possível bateria" });
    expect((await submit()).json().error.code).toBe("DIAGNOSTICO_NAO_CONFIRMADO");
    const authorized = await submit({ authorizeSuspicion: true });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().quote.suspicionAuthorizedBy).toBeTruthy();
  });

  it("exige itens, condições de pagamento e previsão de execução", async () => {
    const { orderId, techSession } = await orderInDiagnosis(env, ownerA);
    await diagnose(env, techSession, orderId);
    const empty = (await call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, { items: [] })).json();
    const noItems = await call(env, ownerA, "POST", `/quotes/${empty.id}/submit`, { revision: empty.revision });
    expect(noItems.json().error.code).toBe("ORCAMENTO_SEM_ITENS");
    const filled = await call(env, ownerA, "PUT", `/quotes/${empty.id}`, { items: goodQuote().items, revision: empty.revision });
    const noTerms = await call(env, ownerA, "POST", `/quotes/${empty.id}/submit`, { revision: filled.json().revision });
    expect(noTerms.json().error.code).toBe("CAMPOS_OBRIGATORIOS_AUSENTES");
    expect(noTerms.json().error.details.missing).toEqual(["paymentTerms", "estimatedDays"]);
  });

  it("envia: fixa a validade (7 dias pelo relógio), move a OS e congela o conteúdo", async () => {
    const { orderId, techSession } = await orderInDiagnosis(env, ownerA);
    await diagnose(env, techSession, orderId);
    const sent = await sendQuote(env, ownerA, orderId);
    expect(new Date(sent.validUntil).toISOString()).toBe("2026-11-10T12:00:00.000Z");
    const detail = await orderDetail(env, ownerA, orderId);
    expect(detail.state).toBe("AGUARDANDO_APROVACAO");
    expect(detail.events.at(-1)).toMatchObject({ type: "orcamento_enviado", toState: "AGUARDANDO_APROVACAO" });
    const edit = await call(env, ownerA, "PUT", `/quotes/${sent.id}`, { ...goodQuote({ discountCents: 0 }), revision: 99 });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().error.code).toBe("ORCAMENTO_NAO_EDITAVEL");
    const resubmit = await call(env, ownerA, "POST", `/quotes/${sent.id}/submit`, { revision: 1 });
    expect(resubmit.statusCode).toBe(409);
  });
});

describe("revisão", () => {
  it("revisar substitui a versão enviada por um novo rascunho com os mesmos itens e devolve a OS ao diagnóstico", async () => {
    const { orderId, techSession } = await orderInDiagnosis(env, ownerA);
    await diagnose(env, techSession, orderId);
    const sent = await sendQuote(env, ownerA, orderId);
    const revised = await call(env, ownerA, "POST", `/quotes/${sent.id}/revise`, {});
    expect(revised.statusCode).toBe(201);
    expect(revised.json().quote).toMatchObject({ number: 2, state: "rascunho", totalCents: sent.totalCents });
    expect(revised.json().quote.items).toHaveLength(2);
    const quotes = await quoteOf(orderId);
    expect(quotes.map((q) => [q.number, q.state])).toEqual([[2, "rascunho"], [1, "substituido"]]);
    expect((await orderDetail(env, ownerA, orderId)).state).toBe("EM_DIAGNOSTICO");
    // Decidir a versão substituída é recusado.
    const stale = await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody());
    expect(stale.statusCode).toBe(422);
    expect(stale.json().error.code).toBe("ORCAMENTO_NAO_ENVIADO");
  });

  it("técnico não revisa; rascunho não pode ser revisado", async () => {
    const { orderId, techSession } = await orderInDiagnosis(env, ownerA);
    await diagnose(env, techSession, orderId);
    const draft = (await call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, goodQuote())).json();
    expect((await call(env, ownerA, "POST", `/quotes/${draft.id}/revise`, {})).json().error.code).toBe("ORCAMENTO_NAO_ENVIADO");
    expect((await call(env, techSession, "POST", `/quotes/${draft.id}/revise`, {})).statusCode).toBe(403);
  });
});

