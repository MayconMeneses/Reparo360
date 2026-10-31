import { schema, withContext } from "@reparo360/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember, call, decisionBody, diagnose, goodQuote, loginOk, onboard, orderInDiagnosis, orderInRepair, orderReadyForPickup, portalLink,
  portalRead, resetData, sendQuote, startTestEnv, transition, deliver, type Account, type Session, type TestEnv,
} from "./helpers.js";

let env: TestEnv;
let now: Date;
let a: Account;
let ownerA: Session;
let ownerB: Session;
const logLines: string[] = [];

beforeAll(async () => {
  env = await startTestEnv({ LOG_LEVEL: "info" }, () => now, { write: (chunk: string) => void logLines.push(chunk) });
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  now = new Date("2026-11-03T12:00:00Z");
  logLines.length = 0;
  await resetData(env.migrator);
  a = await onboard(env, "portalA");
  const b = await onboard(env, "portalB");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

describe("criação do link", () => {
  it("devolve o token uma vez, com caminho em fragmento, e o banco guarda só o hash", async () => {
    const { orderId } = await orderInRepair(env, ownerA);
    const link = await portalLink(env, ownerA, orderId);
    expect(link.token).toHaveLength(43);
    expect(link.path).toBe(`/portal#t=${link.token}`);
    expect(new Date(link.expiresAt).toISOString()).toBe("2026-12-03T12:00:00.000Z");
    const grants = await withContext(env.migrator, { tenantId: a.tenantId }, (db) => db.select().from(schema.customerAccessGrants));
    expect(grants).toHaveLength(1);
    expect(grants[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(grants)).not.toContain(link.token);
  });

  it("gerar outro link revoga o anterior", async () => {
    const { orderId } = await orderInRepair(env, ownerA);
    const first = await portalLink(env, ownerA, orderId);
    const second = await portalLink(env, ownerA, orderId);
    expect((await portalRead(env, first.token)).statusCode).toBe(404);
    expect((await portalRead(env, second.token)).statusCode).toBe(200);
  });

  it("papéis: atendente e gerente geram; técnico não; outra empresa recebe 404; sem sessão, 401", async () => {
    const { orderId, techSession } = await orderInRepair(env, ownerA);
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    expect((await call(env, clerk, "POST", `/work-orders/${orderId}/portal-link`, {})).statusCode).toBe(201);
    expect((await call(env, techSession, "POST", `/work-orders/${orderId}/portal-link`, {})).statusCode).toBe(403);
    expect((await call(env, ownerB, "POST", `/work-orders/${orderId}/portal-link`, {})).statusCode).toBe(404);
    expect((await call(env, null, "POST", `/work-orders/${orderId}/portal-link`, {})).statusCode).toBe(401);
  });

  it("revogar: 204 e o link deixa de funcionar; sem link ativo, 404", async () => {
    const { orderId } = await orderInRepair(env, ownerA);
    expect((await call(env, ownerA, "DELETE", `/work-orders/${orderId}/portal-link`)).statusCode).toBe(404);
    const link = await portalLink(env, ownerA, orderId);
    expect((await call(env, ownerA, "DELETE", `/work-orders/${orderId}/portal-link`)).statusCode).toBe(204);
    expect((await portalRead(env, link.token)).statusCode).toBe(404);
  });
});

describe("o que o consumidor vê (lista branca)", () => {
  it("mostra andamento, equipamento, contato da assistência, linha do tempo e orçamento; nada interno", async () => {
    await call(env, ownerA, "PATCH", "/tenant", { phone: "(85) 3333-4444" });
    const { orderId, protocol } = await orderInRepair(env, ownerA);
    // Evento com motivo livre: não pode aparecer no portal.
    await transition(env, ownerA, orderId, "novo_defeito", "Motivo interno sigiloso do técnico");
    const { token } = await portalLink(env, ownerA, orderId);
    const res = await portalRead(env, token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      protocol,
      state: { code: "EM_DIAGNOSTICO", label: "Em diagnóstico" },
      device: { category: "celular", brand: "Marca", model: "Modelo X" },
      assistance: { name: "Assistência portalA", phone: "8533334444" },
      canDecide: false,
      readyForPickup: false,
    });
    expect(body.timeline.map((e: { label: string }) => e.label)).toEqual(["Equipamento recebido", "Diagnóstico iniciado", "Orçamento disponível", "Orçamento aprovado"]);
    expect(body.quote).toMatchObject({ number: 1, state: "aprovado", totalCents: 24180 });
    const text = res.body;
    for (const secret of ["Maria Teste", "85999991234", "Não liga", "Motivo interno sigiloso", a.email, a.userId, "Tela trincada", "490154203237518", "idempot", "csrf"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("sem botões de decisão (P-03): orienta falar com a assistência; o token não decide nada", async () => {
    const order = await orderInDiagnosis(env, ownerA);
    await diagnose(env, order.techSession, order.orderId);
    const sent = await sendQuote(env, ownerA, order.orderId);
    const { token } = await portalLink(env, ownerA, order.orderId);
    const body = (await portalRead(env, token)).json();
    expect(body.canDecide).toBe(false);
    expect(body.decisionMessage).toContain("fale com a assistência");
    const attempt = await env.app.inject({ method: "POST", url: `/api/v1/quotes/${sent.id}/decision`, headers: { "x-portal-token": token }, payload: decisionBody() });
    expect(attempt.statusCode).toBe(401);
  });

  it("rascunho nunca aparece; versão substituída aparece rotulada", async () => {
    const order = await orderInDiagnosis(env, ownerA);
    await diagnose(env, order.techSession, order.orderId);
    const { token } = await portalLink(env, ownerA, order.orderId);
    await call(env, ownerA, "POST", `/work-orders/${order.orderId}/quotes`, goodQuote());
    expect((await portalRead(env, token)).json().quote).toBeNull();
    const draft = (await call(env, ownerA, "GET", `/work-orders/${order.orderId}/quotes`)).json().quotes[0];
    const sent = await call(env, ownerA, "POST", `/quotes/${draft.id}/submit`, { revision: draft.revision });
    await call(env, ownerA, "POST", `/quotes/${sent.json().quote.id}/revise`, {});
    expect((await portalRead(env, token)).json().quote).toMatchObject({ number: 1, state: "substituido" });
  });

  it("pronto para retirada é sinalizado", async () => {
    const { orderId } = await orderReadyForPickup(env, ownerA);
    const { token } = await portalLink(env, ownerA, orderId);
    const body = (await portalRead(env, token)).json();
    expect(body).toMatchObject({ readyForPickup: true, state: { label: "Pronto para retirada" } });
  });

  it("cabeçalhos: sem referrer, sem indexação, sem cache", async () => {
    const { orderId } = await orderInRepair(env, ownerA);
    const res = await portalRead(env, (await portalLink(env, ownerA, orderId)).token);
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-robots-tag"]).toContain("noindex");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("falhas de acesso respondem todas igual", () => {
  it("aleatório, curto, ausente, expirado, revogado, substituído e OS encerrada: mesmo 404 e mesmo corpo", async () => {
    const { orderId } = await orderReadyForPickup(env, ownerA);
    const expired = (await portalLink(env, ownerA, orderId)).token;
    const reference = await portalRead(env, "A".repeat(43));
    expect(reference.statusCode).toBe(404);
    expect(reference.json().error.code).toBe("LINK_INVALIDO");

    const bodies: unknown[] = [(await portalRead(env, "curto")).json(), (await portalRead(env)).json()];
    now = new Date("2026-12-04T12:00:00Z"); // depois dos 30 dias
    bodies.push((await portalRead(env, expired)).json());

    now = new Date("2026-11-03T12:00:00Z");
    const revoked = (await portalLink(env, ownerA, orderId)).token;
    await call(env, ownerA, "DELETE", `/work-orders/${orderId}/portal-link`);
    bodies.push((await portalRead(env, revoked)).json());

    const closed = (await portalLink(env, ownerA, orderId)).token;
    expect((await portalRead(env, closed)).statusCode).toBe(200);
    await deliver(env, ownerA, orderId);
    await transition(env, ownerA, orderId, "encerrar");
    const closedRes = await portalRead(env, closed);
    expect(closedRes.statusCode).toBe(404);
    bodies.push(closedRes.json());

    for (const body of bodies) expect(body).toEqual(reference.json());
  });

  it("não se cria link para OS encerrada", async () => {
    const { orderId } = await orderReadyForPickup(env, ownerA);
    await deliver(env, ownerA, orderId);
    await transition(env, ownerA, orderId, "encerrar");
    const res = await call(env, ownerA, "POST", `/work-orders/${orderId}/portal-link`, {});
    expect(res.statusCode).toBe(422);
  });

  it("limita tentativas por IP (429)", async () => {
    const limited = await startTestEnv({ PORTAL_RATE_LIMIT_MAX: "3" });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await portalRead(limited, `${"B".repeat(42)}${i}`)).statusCode);
      expect(codes).toEqual([404, 404, 404, 429, 429]);
    } finally {
      await limited.close();
    }
  });
});

describe("o token não vaza", () => {
  it("não aparece nos logs do servidor (cabeçalho redigido, token fora da URL)", async () => {
    const { orderId } = await orderInRepair(env, ownerA);
    const { token } = await portalLink(env, ownerA, orderId);
    logLines.length = 0;
    expect((await portalRead(env, token)).statusCode).toBe(200);
    expect((await portalRead(env, token.slice(0, 40) + "xyz")).statusCode).toBe(404);
    const logs = logLines.join("");
    expect(logs.length).toBeGreaterThan(0); // o log existe...
    expect(logs).toContain("/api/v1/portal/order"); // ...registra a requisição...
    expect(logs).not.toContain(token); // ...mas nunca o token
    expect(logs).not.toContain(token.slice(0, 30));
  });
});
