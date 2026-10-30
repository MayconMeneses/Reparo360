import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addMember, call, loginOk, newCustomer, newDevice, onboard, resetData, startTestEnv, type Account, type Session, type TestEnv } from "./helpers.js";

let env: TestEnv;
let a: Account;
let b: Account;
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
  a = await onboard(env, "balcaoA");
  b = await onboard(env, "balcaoB");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

describe("clientes", () => {
  it("cadastra com telefone normalizado e e-mail em minúsculas", async () => {
    const res = await call(env, ownerA, "POST", "/customers", { name: "João da Silva", phone: "+55 (85) 99999-1234", email: "Joao@Teste.Invalid" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ phone: "85999991234", email: "joao@teste.invalid" });
  });

  it("rejeita telefone inválido, e-mail inválido e campos desconhecidos (mass assignment)", async () => {
    expect((await call(env, ownerA, "POST", "/customers", { name: "Fulano", phone: "123" })).statusCode).toBe(400);
    expect((await call(env, ownerA, "POST", "/customers", { name: "Fulano", phone: "85999991234", email: "x" })).statusCode).toBe(400);
    expect((await call(env, ownerA, "POST", "/customers", { name: "Fulano", phone: "85999991234", tenantId: b.tenantId })).statusCode).toBe(400);
  });

  it("avisa de possível duplicidade sem fundir; só cadastra com confirmação", async () => {
    const first = await newCustomer(env, ownerA, "Maria Original", "(85) 98888-0000");
    const dup = await call(env, ownerA, "POST", "/customers", { name: "Outra Maria", phone: "85988880000" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("POSSIVEL_DUPLICIDADE");
    expect(dup.json().error.details.candidates.map((c: { id: string }) => c.id)).toEqual([first]);
    const confirmed = await call(env, ownerA, "POST", "/customers", { name: "Outra Maria", phone: "85988880000", confirmDuplicate: true });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json().id).not.toBe(first);
  });

  it("a duplicidade só considera a própria empresa", async () => {
    await newCustomer(env, ownerA, "Cliente A", "85977770000");
    const inB = await call(env, ownerB, "POST", "/customers", { name: "Cliente B", phone: "85977770000" });
    expect(inB.statusCode).toBe(201);
  });

  it("busca por nome, por telefone, e trata % e _ como texto literal", async () => {
    await newCustomer(env, ownerA, "Ana Paula", "85911110001");
    await newCustomer(env, ownerA, "100% Celulares", "85911110002");
    await newCustomer(env, ownerA, "Bruno_Lima", "85911110003");
    const names = async (q: string) =>
      (await call(env, ownerA, "GET", `/customers?q=${encodeURIComponent(q)}`)).json<{ customers: Array<{ name: string }> }>().customers.map((c) => c.name);
    expect(await names("paula")).toEqual(["Ana Paula"]);
    expect(await names("859111100")).toHaveLength(3);
    expect(await names("%")).toEqual(["100% Celulares"]);
    expect(await names("_")).toEqual(["Bruno_Lima"]);
  });

  it("pagina com ordem estável e limita o tamanho da página", async () => {
    for (let i = 0; i < 5; i++) await newCustomer(env, ownerA, `Cliente ${i}`, `8590000000${i}`);
    const page1 = (await call(env, ownerA, "GET", "/customers?limit=2&offset=0")).json<{ customers: Array<{ id: string }> }>().customers;
    const page2 = (await call(env, ownerA, "GET", "/customers?limit=2&offset=2")).json<{ customers: Array<{ id: string }> }>().customers;
    const page3 = (await call(env, ownerA, "GET", "/customers?limit=2&offset=4")).json<{ customers: Array<{ id: string }> }>().customers;
    const all = [...page1, ...page2, ...page3].map((c) => c.id);
    expect(all).toHaveLength(5);
    expect(new Set(all).size).toBe(5);
    expect((await call(env, ownerA, "GET", "/customers?limit=51")).statusCode).toBe(400);
  });

  it("edita dados do cliente", async () => {
    const id = await newCustomer(env, ownerA);
    const res = await call(env, ownerA, "PATCH", `/customers/${id}`, { name: "Nome Corrigido", email: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Nome Corrigido", email: null });
    expect((await call(env, ownerA, "PATCH", `/customers/${id}`, {})).statusCode).toBe(400);
  });
});

describe("clientes: acesso entre empresas e permissões", () => {
  it("A não lê, edita nem lista cliente de B; a resposta é igual à de id inexistente", async () => {
    const inB = await newCustomer(env, ownerB, "Cliente Privado B", "85955550000");
    const cross = await call(env, ownerA, "GET", `/customers/${inB}`);
    const missing = await call(env, ownerA, "GET", "/customers/00000000-0000-4000-8000-000000000000");
    expect(cross.statusCode).toBe(404);
    expect(cross.json()).toEqual(missing.json());
    expect((await call(env, ownerA, "PATCH", `/customers/${inB}`, { name: "Invadido" })).statusCode).toBe(404);
    const list = (await call(env, ownerA, "GET", "/customers?q=Privado")).json<{ customers: unknown[] }>().customers;
    expect(list).toHaveLength(0);
    expect((await call(env, ownerB, "GET", `/customers/${inB}`)).json().name).toBe("Cliente Privado B");
  });

  it("atendente cadastra; técnico não acessa cadastro de clientes", async () => {
    const clerk = await addMember(env, ownerA, "atendente");
    const tech = await addMember(env, ownerA, "tecnico");
    const clerkSession = await loginOk(env, clerk.email);
    const techSession = await loginOk(env, tech.email);
    expect((await call(env, clerkSession, "POST", "/customers", { name: "Cliente Balcão", phone: "85944440000" })).statusCode).toBe(201);
    expect((await call(env, techSession, "GET", "/customers")).statusCode).toBe(403);
    expect((await call(env, techSession, "POST", "/customers", { name: "Cliente X", phone: "85944440001" })).statusCode).toBe(403);
  });

  it("sem sessão: 401", async () => {
    expect((await call(env, null, "GET", "/customers")).statusCode).toBe(401);
  });
});

describe("equipamentos", () => {
  const VALID_IMEI = "490154203237518";

  it("cadastra equipamento do cliente com IMEI válido e lista", async () => {
    const customerId = await newCustomer(env, ownerA);
    const deviceId = await newDevice(env, ownerA, customerId, { imei: VALID_IMEI, serialNumber: "SN-123" });
    const list = (await call(env, ownerA, "GET", `/customers/${customerId}/devices`)).json<{ devices: Array<{ id: string }> }>().devices;
    expect(list.map((d) => d.id)).toEqual([deviceId]);
  });

  it("rejeita IMEI com dígito verificador errado, categoria inválida e troca de proprietário", async () => {
    const customerId = await newCustomer(env, ownerA);
    const other = await newCustomer(env, ownerA, "Outro Cliente", "85900001111");
    const bad = (extra: object) => call(env, ownerA, "POST", `/customers/${customerId}/devices`, { category: "celular", brand: "M", model: "X", ...extra });
    expect((await bad({ imei: "490154203237519" })).statusCode).toBe(400);
    expect((await bad({ category: "geladeira" })).statusCode).toBe(400);
    expect((await bad({ customerId: other })).statusCode).toBe(400);
    const deviceId = await newDevice(env, ownerA, customerId);
    expect((await call(env, ownerA, "PATCH", `/devices/${deviceId}`, { customerId: other })).statusCode).toBe(400);
  });

  it("edita equipamento", async () => {
    const customerId = await newCustomer(env, ownerA);
    const deviceId = await newDevice(env, ownerA, customerId);
    const res = await call(env, ownerA, "PATCH", `/devices/${deviceId}`, { color: "Preto", imei: VALID_IMEI });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ color: "Preto", imei: VALID_IMEI });
  });

  it("A não cria, lista nem edita equipamento de cliente de B", async () => {
    const customerB = await newCustomer(env, ownerB, "Cliente B", "85933330000");
    const deviceB = await newDevice(env, ownerB, customerB);
    expect((await call(env, ownerA, "POST", `/customers/${customerB}/devices`, { category: "celular", brand: "M", model: "X" })).statusCode).toBe(404);
    expect((await call(env, ownerA, "GET", `/customers/${customerB}/devices`)).statusCode).toBe(404);
    expect((await call(env, ownerA, "PATCH", `/devices/${deviceB}`, { color: "Vermelho" })).statusCode).toBe(404);
  });
});
