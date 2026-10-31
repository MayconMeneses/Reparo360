import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember, call, diagnose, loginOk, newCustomer, newDevice, onboard, orderInDiagnosis, resetData, sendQuote, setupOrder, startTestEnv,
  type Account, type Session, type TestEnv,
} from "./helpers.js";

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
  a = await onboard(env, "cfgA");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, (await onboard(env, "cfgB")).email);
});

describe("configurações da assistência", () => {
  it("qualquer papel lê; proprietário e gerente alteram; atendente e técnico não", async () => {
    const manager = await loginOk(env, (await addMember(env, ownerA, "gerente")).email);
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    const tech = await loginOk(env, (await addMember(env, ownerA, "tecnico")).email);
    for (const s of [ownerA, manager, clerk, tech]) expect((await call(env, s, "GET", "/tenant")).statusCode).toBe(200);
    expect((await call(env, manager, "PATCH", "/tenant", { tradeName: "Loja do Gerente" })).statusCode).toBe(200);
    expect((await call(env, clerk, "PATCH", "/tenant", { tradeName: "Invasão" })).statusCode).toBe(403);
    expect((await call(env, tech, "PATCH", "/tenant", { tradeName: "Invasão" })).statusCode).toBe(403);
  });

  it("normaliza o telefone e rejeita campos que não são editáveis (status, e-mail administrativo)", async () => {
    const ok = await call(env, ownerA, "PATCH", "/tenant", { phone: "+55 (85) 3333-4444" });
    expect(ok.json()).toMatchObject({ phone: "8533334444", name: "Assistência cfgA" });
    for (const body of [{ phone: "123" }, { status: "ativa" }, { adminEmail: "outro@teste.invalid" }, { id: "x" }, {}]) {
      expect((await call(env, ownerA, "PATCH", "/tenant", body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it("alterar a própria empresa não toca a outra", async () => {
    await call(env, ownerA, "PATCH", "/tenant", { tradeName: "Só da A" });
    expect((await call(env, ownerB, "GET", "/tenant")).json().tradeName).toBeNull();
  });
});

describe("lista de equipamentos", () => {
  it("lista com cliente, busca por marca/modelo/cliente, filtra por categoria e pagina", async () => {
    const maria = await newCustomer(env, ownerA, "Maria Souza", "85911110001");
    const joao = await newCustomer(env, ownerA, "João Lima", "85911110002");
    await newDevice(env, ownerA, maria, { brand: "Samsung", model: "Galaxy A54" });
    await newDevice(env, ownerA, joao, { brand: "Dell", model: "Inspiron", category: "notebook" });
    const list = async (q: string) => (await call(env, ownerA, "GET", `/devices${q}`)).json<{ devices: Array<{ brand: string; customerName: string }> }>().devices;
    expect(await list("")).toHaveLength(2);
    expect((await list("?q=samsung"))[0]).toMatchObject({ brand: "Samsung", customerName: "Maria Souza" });
    expect((await list("?q=lima"))[0]?.brand).toBe("Dell");
    expect((await list("?category=notebook")).map((d) => d.brand)).toEqual(["Dell"]);
    expect(await list("?q=%25")).toHaveLength(0); // % é texto literal, não curinga
    expect((await list("?limit=1"))).toHaveLength(1);
    expect((await call(env, ownerA, "GET", "/devices?limit=51")).statusCode).toBe(400);
  });

  it("papéis e isolamento", async () => {
    await newDevice(env, ownerB, await newCustomer(env, ownerB), { brand: "SóDaB" });
    const tech = await loginOk(env, (await addMember(env, ownerA, "tecnico")).email);
    expect((await call(env, tech, "GET", "/devices")).statusCode).toBe(403);
    expect((await call(env, ownerA, "GET", "/devices")).json().devices).toHaveLength(0);
    expect((await call(env, null, "GET", "/devices")).statusCode).toBe(401);
  });
});

describe("lista de orçamentos", () => {
  it("traz só versões enviadas ou decididas (nunca rascunho), com a OS e o cliente", async () => {
    const sentOrder = await orderInDiagnosis(env, ownerA);
    await diagnose(env, sentOrder.techSession, sentOrder.orderId);
    const sent = await sendQuote(env, ownerA, sentOrder.orderId);
    const draftOrder = await orderInDiagnosis(env, ownerA);
    await call(env, ownerA, "POST", `/work-orders/${draftOrder.orderId}/quotes`, { items: [{ kind: "servico", description: "Serviço", quantity: 1, unitPriceCents: 100 }] });
    const res = await call(env, ownerA, "GET", "/quotes");
    const quotes = res.json<{ quotes: Array<{ id: string; state: string; protocol: string; customerName: string; totalCents: number }> }>().quotes;
    expect(quotes.map((q) => q.id)).toEqual([sent.id]);
    expect(quotes[0]).toMatchObject({ state: "enviado", protocol: sentOrder.protocol, customerName: "Maria Teste", totalCents: 24180 });
    expect((await call(env, ownerA, "GET", "/quotes?state=aprovado")).json().quotes).toHaveLength(0);
    expect((await call(env, ownerA, "GET", "/quotes?state=rascunho")).statusCode).toBe(400);
  });

  it("técnico vê só orçamentos das OS atribuídas a ele; outra empresa não vê nada", async () => {
    const mine = await orderInDiagnosis(env, ownerA);
    await diagnose(env, mine.techSession, mine.orderId);
    const mineQuote = await sendQuote(env, ownerA, mine.orderId);
    const other = await orderInDiagnosis(env, ownerA);
    await diagnose(env, other.techSession, other.orderId);
    await sendQuote(env, ownerA, other.orderId);
    const seen = (await call(env, mine.techSession, "GET", "/quotes")).json<{ quotes: Array<{ id: string }> }>().quotes;
    expect(seen.map((q) => q.id)).toEqual([mineQuote.id]);
    expect((await call(env, ownerB, "GET", "/quotes")).json().quotes).toHaveLength(0);
    expect((await setupOrder(env, ownerB)).orderId).toBeTruthy();
  });
});
