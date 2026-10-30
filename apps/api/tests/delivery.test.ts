import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember, call, decisionBody, deliver, deliveryBody, diagnose, goodQuote, JPEG, loginOk, onboard, openOrder, orderDetail, orderInDiagnosis,
  orderInRepair, orderReadyForPickup, resetData, sendQuote, setupOrder, startTestEnv, transition, upload,
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
  a = await onboard(env, "entregaA");
  const b = await onboard(env, "entregaB");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

describe("entrega", () => {
  it("a ação 'entregar' não existe no endpoint genérico de transições", async () => {
    const { orderId } = await orderReadyForPickup(env, ownerA);
    const res = await transition(env, ownerA, orderId, "entregar");
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("ACAO_INDISPONIVEL");
    expect((await orderDetail(env, ownerA, orderId)).state).toBe("PRONTA_RETIRADA");
  });

  it("registra a entrega e move a OS para ENTREGUE na mesma operação", async () => {
    const { orderId } = await orderReadyForPickup(env, ownerA);
    const res = await deliver(env, ownerA, orderId, { note: undefined });
    expect(res.statusCode).toBe(201);
    expect(res.json().state).toBe("ENTREGUE");
    const detail = await orderDetail(env, ownerA, orderId);
    expect(detail.state).toBe("ENTREGUE");
    expect(detail.delivery).toMatchObject({ pickedUpByName: "Maria Teste", confirmationMethod: "comprovante_apresentado", itemsReturned: ["carregador"] });
    expect(detail.events.at(-1)).toMatchObject({ type: "entregue", fromState: "PRONTA_RETIRADA", toState: "ENTREGUE" });
  });

  it("acessórios diferentes dos recebidos exigem observação", async () => {
    const { orderId } = await orderReadyForPickup(env, ownerA);
    const missing = await deliver(env, ownerA, orderId, { itemsReturned: [] });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.code).toBe("OBSERVACAO_OBRIGATORIA");
    expect((await orderDetail(env, ownerA, orderId)).state).toBe("PRONTA_RETIRADA");
    const explained = await deliver(env, ownerA, orderId, { itemsReturned: [], note: "Cliente deixou o carregador para buscar depois" });
    expect(explained.statusCode).toBe(201);
  });

  it("não entrega OS que não está pronta e não deixa registro órfão", async () => {
    const { orderId } = await orderInRepair(env, ownerA);
    const res = await deliver(env, ownerA, orderId);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("TRANSICAO_INVALIDA");
    // A conferência de estado vem antes da de acessórios: a mensagem não engana.
    const mismatch = await deliver(env, ownerA, orderId, { itemsReturned: [] });
    expect(mismatch.json().error.code).toBe("TRANSICAO_INVALIDA");
    const detail = await orderDetail(env, ownerA, orderId);
    expect(detail.delivery).toBeNull();
    expect(detail.state).toBe("EM_REPARO");
  });

  it("versão desatualizada: 409. Duplo clique: exatamente uma entrega e um evento", async () => {
    const { orderId } = await orderReadyForPickup(env, ownerA);
    const stale = await call(env, ownerA, "POST", `/work-orders/${orderId}/delivery`, deliveryBody(1));
    expect(stale.statusCode).toBe(409);
    const { version } = await orderDetail(env, ownerA, orderId);
    const body = deliveryBody(version);
    const [x, y] = await Promise.all([
      call(env, ownerA, "POST", `/work-orders/${orderId}/delivery`, body),
      call(env, ownerA, "POST", `/work-orders/${orderId}/delivery`, body),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([201, 409]);
    const events = (await orderDetail(env, ownerA, orderId)).events as Array<{ type: string }>;
    expect(events.filter((e) => e.type === "entregue")).toHaveLength(1);
  });

  it("papéis: atendente entrega; técnico não; outra empresa recebe 404", async () => {
    const { orderId, techSession } = await orderReadyForPickup(env, ownerA);
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    const { version } = await orderDetail(env, ownerA, orderId);
    expect((await call(env, techSession, "POST", `/work-orders/${orderId}/delivery`, deliveryBody(version))).statusCode).toBe(403);
    expect((await call(env, ownerB, "POST", `/work-orders/${orderId}/delivery`, deliveryBody(version))).statusCode).toBe(404);
    expect((await call(env, clerk, "POST", `/work-orders/${orderId}/delivery`, deliveryBody(version))).statusCode).toBe(201);
  });

  it("retirada sem reparo (orçamento recusado) também é entregue com registro", async () => {
    const order = await orderInDiagnosis(env, ownerA);
    await diagnose(env, order.techSession, order.orderId);
    const sent = await sendQuote(env, ownerA, order.orderId);
    await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody({ decision: "recusado" }));
    expect((await orderDetail(env, ownerA, order.orderId)).state).toBe("PRONTA_RETIRADA_SEM_REPARO");
    const res = await deliver(env, ownerA, order.orderId);
    expect(res.statusCode).toBe(201);
    expect(res.json().state).toBe("ENTREGUE");
  });

  it("valida o corpo: método fora da lista, nome curto e campos extras", async () => {
    const { orderId } = await orderReadyForPickup(env, ownerA);
    const { version } = await orderDetail(env, ownerA, orderId);
    for (const bad of [{ confirmationMethod: "digital" }, { pickedUpByName: "M" }, { documentNumber: "123.456.789-00" }]) {
      expect((await call(env, ownerA, "POST", `/work-orders/${orderId}/delivery`, deliveryBody(version, bad))).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });
});

describe("encerramento (P-17: manual)", () => {
  it("só gerente/proprietário encerram, e só depois de entregue", async () => {
    const { orderId } = await orderReadyForPickup(env, ownerA);
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    expect((await transition(env, ownerA, orderId, "encerrar")).json().error.code).toBe("TRANSICAO_INVALIDA");
    await deliver(env, ownerA, orderId);
    expect((await transition(env, clerk, orderId, "encerrar")).statusCode).toBe(403);
    const closed = await transition(env, ownerA, orderId, "encerrar");
    expect(closed.json().state).toBe("ENCERRADA");
    expect((await orderDetail(env, ownerA, orderId)).events.at(-1)).toMatchObject({ type: "os_encerrada", toState: "ENCERRADA" });
  });

  it("OS encerrada e OS cancelada são imutáveis em todos os endpoints de escrita (RN-007)", async () => {
    const closed = await orderReadyForPickup(env, ownerA);
    const attachment = (await upload(env, ownerA, closed.orderId, "image/jpeg", JPEG)).json<{ id: string }>();
    await deliver(env, ownerA, closed.orderId);
    await transition(env, ownerA, closed.orderId, "encerrar");

    const cancelled = await setupOrder(env, ownerA);
    await transition(env, ownerA, cancelled.orderId, "cancelar", "Cliente desistiu");

    for (const { orderId } of [closed, cancelled]) {
      const { version } = await orderDetail(env, ownerA, orderId);
      const attempts = [
        upload(env, ownerA, orderId, "image/jpeg", JPEG),
        call(env, ownerA, "PATCH", `/work-orders/${orderId}/technician`, { technicianId: null, version }),
        call(env, ownerA, "POST", `/work-orders/${orderId}/diagnostics`, { nature: "confirmado", symptoms: "s", checksPerformed: "c", findings: "f" }),
        call(env, ownerA, "POST", `/work-orders/${orderId}/quotes`, goodQuote()),
        call(env, ownerA, "POST", `/work-orders/${orderId}/repairs`, { procedure: "Procedimento", outcome: "concluido" }),
        call(env, ownerA, "POST", `/work-orders/${orderId}/test-checks`, { items: [{ item: "Carga", result: "aprovado" }] }),
        call(env, ownerA, "POST", `/work-orders/${orderId}/delivery`, deliveryBody(version)),
        call(env, ownerA, "POST", `/work-orders/${orderId}/claim`, { expectedVersion: version }),
      ];
      for (const res of await Promise.all(attempts)) {
        expect([409, 422], `${res.statusCode} ${res.body}`).toContain(res.statusCode);
      }
      for (const action of ["iniciar_diagnostico", "cancelar", "reabrir_diagnostico", "reabrir_bancada", "encerrar", "novo_defeito"]) {
        expect((await transition(env, ownerA, orderId, action, "tentativa")).statusCode, action).toBe(422);
      }
    }
    // Excluir anexo de OS encerrada também é recusado, e o anexo continua lá.
    const del = await call(env, ownerA, "DELETE", `/attachments/${attachment.id}`);
    expect(del.statusCode).toBe(422);
    expect(del.json().error.code).toBe("OS_ENCERRADA");
    expect((await orderDetail(env, ownerA, closed.orderId)).attachments).toHaveLength(1);
    expect((await orderDetail(env, ownerA, closed.orderId)).state).toBe("ENCERRADA");
  });
});

describe("retorno ou reclamação (OS de origem)", () => {
  it("a nova OS aponta para a anterior entregue, do mesmo equipamento", async () => {
    const original = await orderReadyForPickup(env, ownerA);
    await deliver(env, ownerA, original.orderId);
    const returned = await openOrder(env, ownerA, original.customerId, original.deviceId, { originWorkOrderId: original.orderId });
    expect(returned.statusCode).toBe(201);
    const detail = await orderDetail(env, ownerA, returned.json().id);
    expect(detail.origin).toEqual({ id: original.orderId, protocol: original.protocol });
    expect(detail.state).toBe("RECEBIDA");
    expect(returned.json().protocol).not.toBe(original.protocol);
  });

  it("recusa origem não entregue, de outro equipamento, inexistente ou de outra empresa", async () => {
    const original = await orderReadyForPickup(env, ownerA);
    const notYet = await openOrder(env, ownerA, original.customerId, original.deviceId, { originWorkOrderId: original.orderId });
    expect(notYet.statusCode).toBe(422);
    expect(notYet.json().error.code).toBe("ORIGEM_INVALIDA");
    await deliver(env, ownerA, original.orderId);

    const other = await setupOrder(env, ownerA);
    const wrongDevice = await openOrder(env, ownerA, other.customerId, other.deviceId, { originWorkOrderId: original.orderId });
    expect(wrongDevice.json().error.code).toBe("ORIGEM_INVALIDA");
    const ghost = await openOrder(env, ownerA, original.customerId, original.deviceId, { originWorkOrderId: "00000000-0000-4000-8000-000000000000" });
    expect(ghost.statusCode).toBe(404);

    const inB = await orderReadyForPickup(env, ownerB);
    await deliver(env, ownerB, inB.orderId);
    const cross = await openOrder(env, ownerA, original.customerId, original.deviceId, { originWorkOrderId: inB.orderId });
    expect(cross.statusCode).toBe(404);
  });
});
