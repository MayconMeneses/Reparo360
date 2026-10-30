import { protocolYear } from "@reparo360/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember, call, inspectionPayload, loginOk, newCustomer, newDevice, onboard, openOrder, resetData, setupOrder, startTestEnv,
  type Account, type Session, type TestEnv,
} from "./helpers.js";

let env: TestEnv;
let a: Account;
let b: Account;
let ownerA: Session;
let ownerB: Session;
const year = protocolYear(new Date());

beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetData(env.migrator);
  a = await onboard(env, "oficinaA");
  b = await onboard(env, "oficinaB");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

describe("abertura da OS e recebimento", () => {
  it("abre a OS em RECEBIDA com protocolo, inspeção e evento no histórico", async () => {
    const { orderId, protocol } = await setupOrder(env, ownerA);
    expect(protocol).toBe(`${year}-000001`);
    const detail = (await call(env, ownerA, "GET", `/work-orders/${orderId}`)).json();
    expect(detail.state).toBe("RECEBIDA");
    expect(detail.version).toBe(1);
    expect(detail.inspection.checklist).toEqual(inspectionPayload().checklist);
    expect(detail.inspection.passwordInformed).toBe(false);
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(["os_aberta"]);
    expect(detail.customer.phone).toBe("85999991234");
  });

  it("nunca guarda a senha do aparelho: o campo é rejeitado e só a marca 'informada' existe", async () => {
    const customerId = await newCustomer(env, ownerA);
    const deviceId = await newDevice(env, ownerA, customerId);
    const withPassword = await openOrder(env, ownerA, customerId, deviceId, { inspection: inspectionPayload({ devicePassword: "S3nh4-Secr3ta!" }) });
    expect(withPassword.statusCode).toBe(400);
    const informed = await openOrder(env, ownerA, customerId, deviceId, { inspection: inspectionPayload({ passwordInformed: true }) });
    expect(informed.statusCode).toBe(201);
    const detail = (await call(env, ownerA, "GET", `/work-orders/${informed.json().id}`)).json();
    expect(detail.inspection.passwordInformed).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/S3nh4-Secr3ta/);
  });

  it("checklist: itens repetidos e resultados fora da lista são rejeitados; omitido vira lista vazia", async () => {
    const customerId = await newCustomer(env, ownerA);
    const deviceId = await newDevice(env, ownerA, customerId);
    const dup = await openOrder(env, ownerA, customerId, deviceId, {
      inspection: inspectionPayload({ checklist: [{ item: "Tela", result: "funcionando" }, { item: "tela", result: "com_defeito" }] }),
    });
    expect(dup.statusCode).toBe(400);
    const invalid = await openOrder(env, ownerA, customerId, deviceId, { inspection: inspectionPayload({ checklist: [{ item: "Tela", result: "ok" }] }) });
    expect(invalid.statusCode).toBe(400);
    const omitted = await openOrder(env, ownerA, customerId, deviceId, { inspection: { physicalCondition: "Sem avarias visíveis." } });
    expect(omitted.statusCode).toBe(201);
  });

  it("rejeita equipamento que não é do cliente, e cliente/equipamento de outra empresa (404)", async () => {
    const customer1 = await newCustomer(env, ownerA, "Cliente Um", "85911110001");
    const customer2 = await newCustomer(env, ownerA, "Cliente Dois", "85911110002");
    const device2 = await newDevice(env, ownerA, customer2);
    const mismatch = await openOrder(env, ownerA, customer1, device2);
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().error.code).toBe("EQUIPAMENTO_NAO_PERTENCE_AO_CLIENTE");

    const customerB = await newCustomer(env, ownerB, "Cliente B", "85922220001");
    const deviceB = await newDevice(env, ownerB, customerB);
    expect((await openOrder(env, ownerA, customerB, deviceB)).statusCode).toBe(404);
    expect((await openOrder(env, ownerA, customer1, deviceB)).statusCode).toBe(404);
  });

  it("papéis: atendente abre; técnico não abre OS", async () => {
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    const tech = await loginOk(env, (await addMember(env, ownerA, "tecnico")).email);
    const customerId = await newCustomer(env, clerk);
    const deviceId = await newDevice(env, clerk, customerId);
    expect((await openOrder(env, clerk, customerId, deviceId)).statusCode).toBe(201);
    expect((await openOrder(env, tech, customerId, deviceId)).statusCode).toBe(403);
  });
});

describe("protocolo", () => {
  it("é sequencial e único por empresa; B começa do 1 independente de A", async () => {
    await setupOrder(env, ownerA);
    const second = await setupOrder(env, ownerA);
    const firstB = await setupOrder(env, ownerB);
    expect(second.protocol).toBe(`${year}-000002`);
    expect(firstB.protocol).toBe(`${year}-000001`);
  });

  it("10 aberturas simultâneas geram 10 protocolos distintos e consecutivos", async () => {
    const customerId = await newCustomer(env, ownerA);
    const deviceId = await newDevice(env, ownerA, customerId);
    const results = await Promise.all(Array.from({ length: 10 }, () => openOrder(env, ownerA, customerId, deviceId)));
    expect(results.map((r) => r.statusCode)).toEqual(Array(10).fill(201));
    const protocols = results.map((r) => r.json().protocol as string).sort();
    expect(protocols).toEqual(Array.from({ length: 10 }, (_, i) => `${year}-${String(i + 1).padStart(6, "0")}`));
  });

  it("usa o ano de São Paulo: 31/12 22h em Brasília ainda é o ano que termina", async () => {
    for (const [instant, expected] of [["2027-01-01T01:00:00Z", 2026], ["2027-01-01T03:00:00Z", 2027]] as const) {
      await resetData(env.migrator);
      const edge = await startTestEnv({}, () => new Date(instant));
      try {
        const owner = await onboard(edge, "virada");
        const session = await loginOk(edge, owner.email);
        const { protocol } = await setupOrder(edge, session);
        expect(protocol).toBe(`${expected}-000001`);
      } finally {
        await edge.close();
      }
    }
  });
});

describe("idempotência (duplo clique)", () => {
  it("repetir a chave devolve a mesma OS sem consumir protocolo", async () => {
    const customerId = await newCustomer(env, ownerA);
    const deviceId = await newDevice(env, ownerA, customerId);
    const headers = { "idempotency-key": "abertura-12345678" };
    const first = await openOrder(env, ownerA, customerId, deviceId, {}, headers);
    const second = await openOrder(env, ownerA, customerId, deviceId, {}, headers);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.headers["idempotent-replay"]).toBe("true");
    expect(second.json()).toEqual(first.json());
    const next = await openOrder(env, ownerA, customerId, deviceId);
    expect(next.json().protocol).toBe(`${year}-000002`);
  });

  it("duas requisições simultâneas com a mesma chave criam exatamente uma OS, sem lacuna de protocolo", async () => {
    const customerId = await newCustomer(env, ownerA);
    const deviceId = await newDevice(env, ownerA, customerId);
    const headers = { "idempotency-key": "corrida-12345678" };
    const [one, two] = await Promise.all([
      openOrder(env, ownerA, customerId, deviceId, {}, headers),
      openOrder(env, ownerA, customerId, deviceId, {}, headers),
    ]);
    expect([one.statusCode, two.statusCode].sort()).toEqual([200, 201]);
    expect(one.json().id).toBe(two.json().id);
    const list = (await call(env, ownerA, "GET", "/work-orders")).json<{ workOrders: unknown[] }>().workOrders;
    expect(list).toHaveLength(1);
    const next = await openOrder(env, ownerA, customerId, deviceId);
    expect(next.json().protocol).toBe(`${year}-000002`);
  });

  it("reutilizar a chave com outro conteúdo é recusado", async () => {
    const customerId = await newCustomer(env, ownerA);
    const deviceId = await newDevice(env, ownerA, customerId);
    const headers = { "idempotency-key": "reuso-123456789" };
    await openOrder(env, ownerA, customerId, deviceId, {}, headers);
    const other = await openOrder(env, ownerA, customerId, deviceId, { reportedDefect: "Outro defeito" }, headers);
    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe("CHAVE_DE_IDEMPOTENCIA_REUTILIZADA");
  });

  it("a mesma chave em empresas diferentes não colide", async () => {
    const headers = { "idempotency-key": "chave-comum-1234" };
    const customerA = await newCustomer(env, ownerA);
    const customerB = await newCustomer(env, ownerB);
    const first = await openOrder(env, ownerA, customerA, await newDevice(env, ownerA, customerA), {}, headers);
    const second = await openOrder(env, ownerB, customerB, await newDevice(env, ownerB, customerB), {}, headers);
    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
  });
});

describe("atribuição de técnico", () => {
  it("só técnico ativo da empresa pode ser atribuído", async () => {
    const clerk = await addMember(env, ownerA, "atendente");
    const techB = await addMember(env, ownerB, "tecnico");
    const customerId = await newCustomer(env, ownerA);
    const deviceId = await newDevice(env, ownerA, customerId);
    expect((await openOrder(env, ownerA, customerId, deviceId, { technicianId: clerk.userId })).statusCode).toBe(422);
    expect((await openOrder(env, ownerA, customerId, deviceId, { technicianId: techB.userId })).statusCode).toBe(422);
    const tech = await addMember(env, ownerA, "tecnico");
    expect((await openOrder(env, ownerA, customerId, deviceId, { technicianId: tech.userId })).statusCode).toBe(201);
  });

  it("gerente atribui com controle de versão; versão velha dá 409 e nada é sobrescrito", async () => {
    const manager = await loginOk(env, (await addMember(env, ownerA, "gerente")).email);
    const tech1 = await addMember(env, ownerA, "tecnico", "tec1");
    const tech2 = await addMember(env, ownerA, "tecnico", "tec2");
    const { orderId, version } = await setupOrder(env, ownerA);

    const ok = await call(env, manager, "PATCH", `/work-orders/${orderId}/technician`, { technicianId: tech1.userId, version });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(version + 1);

    const stale = await call(env, ownerA, "PATCH", `/work-orders/${orderId}/technician`, { technicianId: tech2.userId, version });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("CONFLITO_DE_VERSAO");
    const detail = (await call(env, ownerA, "GET", `/work-orders/${orderId}`)).json();
    expect(detail.technicianId).toBe(tech1.userId);
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(["os_aberta", "tecnico_atribuido"]);
  });

  it("duas atribuições simultâneas com a mesma versão: uma vence, a outra recebe 409", async () => {
    const tech1 = await addMember(env, ownerA, "tecnico", "tec1");
    const tech2 = await addMember(env, ownerA, "tecnico", "tec2");
    const { orderId, version } = await setupOrder(env, ownerA);
    const [r1, r2] = await Promise.all([
      call(env, ownerA, "PATCH", `/work-orders/${orderId}/technician`, { technicianId: tech1.userId, version }),
      call(env, ownerA, "PATCH", `/work-orders/${orderId}/technician`, { technicianId: tech2.userId, version }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
  });

  it("atendente não reatribui; técnico também não", async () => {
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    const tech = await addMember(env, ownerA, "tecnico");
    const { orderId, version } = await setupOrder(env, ownerA);
    expect((await call(env, clerk, "PATCH", `/work-orders/${orderId}/technician`, { technicianId: tech.userId, version })).statusCode).toBe(403);
  });
});

describe("visibilidade", () => {
  it("técnico vê só as OS atribuídas a ele e sem telefone/e-mail do cliente", async () => {
    const tech = await addMember(env, ownerA, "tecnico");
    const techSession = await loginOk(env, tech.email);
    const mine = await setupOrder(env, ownerA, { technicianId: tech.userId });
    const notMine = await setupOrder(env, ownerA);

    const list = (await call(env, techSession, "GET", "/work-orders")).json<{ workOrders: Array<{ id: string }> }>().workOrders;
    expect(list.map((o) => o.id)).toEqual([mine.orderId]);

    const detail = (await call(env, techSession, "GET", `/work-orders/${mine.orderId}`)).json();
    expect(detail.customer).toEqual({ id: mine.customerId, name: "Maria Teste" });
    expect(JSON.stringify(detail)).not.toMatch(/85999991234/);

    const hidden = await call(env, techSession, "GET", `/work-orders/${notMine.orderId}`);
    const missing = await call(env, techSession, "GET", "/work-orders/00000000-0000-4000-8000-000000000000");
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toEqual(missing.json());
  });

  it("A não vê nem acessa OS de B", async () => {
    const inB = await setupOrder(env, ownerB);
    await setupOrder(env, ownerA);
    const cross = await call(env, ownerA, "GET", `/work-orders/${inB.orderId}`);
    expect(cross.statusCode).toBe(404);
    const listA = (await call(env, ownerA, "GET", "/work-orders")).json<{ workOrders: Array<{ id: string }> }>().workOrders;
    expect(listA.map((o) => o.id)).not.toContain(inB.orderId);
    expect(listA).toHaveLength(1);
    const assign = await call(env, ownerA, "PATCH", `/work-orders/${inB.orderId}/technician`, { technicianId: null, version: 1 });
    expect(assign.statusCode).toBe(404);
  });

  it("lista com filtro por estado e busca por protocolo, e limita a página", async () => {
    const first = await setupOrder(env, ownerA);
    await setupOrder(env, ownerA);
    const byProtocol = (await call(env, ownerA, "GET", `/work-orders?q=${first.protocol}`)).json<{ workOrders: Array<{ id: string }> }>().workOrders;
    expect(byProtocol.map((o) => o.id)).toEqual([first.orderId]);
    const received = (await call(env, ownerA, "GET", "/work-orders?state=RECEBIDA")).json<{ workOrders: unknown[] }>().workOrders;
    expect(received).toHaveLength(2);
    const closed = (await call(env, ownerA, "GET", "/work-orders?state=ENTREGUE")).json<{ workOrders: unknown[] }>().workOrders;
    expect(closed).toHaveLength(0);
    expect((await call(env, ownerA, "GET", "/work-orders?state=INVENTADO")).statusCode).toBe(400);
    expect((await call(env, ownerA, "GET", "/work-orders?limit=51")).statusCode).toBe(400);
  });
});
