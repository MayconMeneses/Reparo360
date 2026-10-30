import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember, call, decisionBody, deliveryBody, goodDiagnostic, goodQuote, goodRepair, inspectionPayload, JPEG, loginOk, onboard, orderDetail,
  passingTests, resetData, startTestEnv, transition, upload, type TestEnv,
} from "./helpers.js";
import { pdfText } from "./pdf.js";

let env: TestEnv;

beforeAll(async () => {
  env = await startTestEnv();
  await resetData(env.migrator);
});
afterAll(async () => {
  await env.close();
});

/**
 * Ciclo completo (spec 34.3, passos 1 a 21) com os papéis reais de cada etapa.
 * Passo 13 (verificação remota do consumidor) NÃO se aplica: a aprovação remota está bloqueada
 * em P-03, então o passo 14 é a decisão PRESENCIAL.
 */
describe("ciclo completo de um atendimento", () => {
  it("do cadastro da assistência ao histórico final, cada etapa pelo papel certo", async () => {
    // 1. Cadastrar a assistência (proprietário).
    const shop = await onboard(env, "ciclo");
    const owner = await loginOk(env, shop.email);
    const other = await onboard(env, "vizinha");
    const otherOwner = await loginOk(env, other.email);

    // 2. Autenticar atendente, gerente e técnico (contas criadas pelo proprietário).
    const clerk = await loginOk(env, (await addMember(env, owner, "atendente")).email);
    const manager = await loginOk(env, (await addMember(env, owner, "gerente")).email);
    const technician = await addMember(env, owner, "tecnico");
    const tech = await loginOk(env, technician.email);

    // 3 e 4. Cliente e equipamento (atendente).
    const customer = (await call(env, clerk, "POST", "/customers", { name: "Maria da Conceição", phone: "(85) 99999-1234", email: "maria@teste.invalid" })).json();
    const device = (await call(env, clerk, "POST", `/customers/${customer.id}/devices`, { category: "celular", brand: "Samsung", model: "Galaxy A54", imei: "490154203237518" })).json();
    expect(customer.id && device.id).toBeTruthy();

    // 5, 6 e 7. Receber, registrar a inspeção e abrir a OS (atendente).
    const opened = await call(env, clerk, "POST", "/work-orders", {
      customerId: customer.id, deviceId: device.id, reportedDefect: "Não liga depois da queda", priority: "alta",
      inspection: inspectionPayload({ passwordInformed: true }),
    }, { "idempotency-key": "ciclo-completo-0001" });
    expect(opened.statusCode).toBe(201);
    const { id: orderId, protocol } = opened.json<{ id: string; protocol: string }>();
    expect(protocol).toMatch(/^\d{4}-000001$/);
    expect((await upload(env, clerk, orderId, "image/jpeg", JPEG)).statusCode).toBe(201); // foto da entrada

    // 8. Comprovante de recebimento (atendente).
    const receipt = await call(env, clerk, "GET", `/work-orders/${orderId}/documents/receipt`);
    expect(receipt.statusCode).toBe(200);
    expect(pdfText(receipt.rawPayload)).toContain("Senha do aparelho informada: sim");

    // 9. Atribuir o técnico (gerente).
    const { version } = await orderDetail(env, manager, orderId);
    expect((await call(env, manager, "PATCH", `/work-orders/${orderId}/technician`, { technicianId: technician.userId, version })).statusCode).toBe(200);

    // 10. Diagnóstico (técnico atribuído).
    expect((await transition(env, tech, orderId, "iniciar_diagnostico")).json().state).toBe("EM_DIAGNOSTICO");
    expect((await call(env, tech, "POST", `/work-orders/${orderId}/diagnostics`, goodDiagnostic())).statusCode).toBe(201);

    // 11. Orçamento: o técnico monta o rascunho; 12. o atendente envia.
    const draft = (await call(env, tech, "POST", `/work-orders/${orderId}/quotes`, goodQuote())).json();
    expect(draft.totalCents).toBe(24180);
    const sent = await call(env, clerk, "POST", `/quotes/${draft.id}/submit`, { revision: draft.revision });
    expect(sent.json().order.state).toBe("AGUARDANDO_APROVACAO");

    // 14. Decisão presencial do cliente (registrada pelo atendente).
    const decided = await call(env, clerk, "POST", `/quotes/${draft.id}/decision`, decisionBody({ confirmedByName: "Maria da Conceição" }));
    expect(decided.json()).toMatchObject({ decision: "aprovado", orderState: "EM_REPARO" });

    // 15 e 16. Reparo (técnico).
    expect((await call(env, tech, "POST", `/work-orders/${orderId}/repairs`, goodRepair({ partsUsed: "Bateria 3000 mAh" }))).statusCode).toBe(201);

    // 17 e 18. Testes finais e liberação para retirada (técnico).
    expect((await transition(env, tech, orderId, "iniciar_testes")).json().state).toBe("EM_TESTE");
    expect((await call(env, tech, "POST", `/work-orders/${orderId}/test-checks`, passingTests())).json().approvable).toBe(true);
    expect((await transition(env, tech, orderId, "aprovar_testes")).json().state).toBe("PRONTA_RETIRADA");

    // 19. Entrega (atendente) e 20. comprovante de entrega.
    const { version: readyVersion } = await orderDetail(env, clerk, orderId);
    const delivered = await call(env, clerk, "POST", `/work-orders/${orderId}/delivery`, deliveryBody(readyVersion, { pickedUpByName: "Maria da Conceição" }));
    expect(delivered.json().state).toBe("ENTREGUE");
    const deliveryDoc = await call(env, clerk, "GET", `/work-orders/${orderId}/documents/delivery`);
    expect(pdfText(deliveryDoc.rawPayload)).toContain("Retirado por: Maria da Conceição");

    // Encerramento manual (gerente), P-17.
    expect((await transition(env, manager, orderId, "encerrar")).json().state).toBe("ENCERRADA");

    // 21. Histórico completo e consistente.
    const detail = await orderDetail(env, owner, orderId);
    expect(detail.state).toBe("ENCERRADA");
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual([
      "os_aberta", "anexo_adicionado", "tecnico_atribuido", "diagnostico_iniciado", "diagnostico_registrado", "orcamento_criado",
      "orcamento_enviado", "orcamento_aprovado", "reparo_registrado", "testes_iniciados", "testes_registrados", "testes_aprovados",
      "entregue", "os_encerrada",
    ]);
    expect(detail.events.every((e: { actorUserId: string | null }) => e.actorUserId)).toBe(true);
    expect(detail.quotes).toHaveLength(1);
    expect(detail.quotes[0]).toMatchObject({ state: "aprovado", totalCents: 24180, decision: { channel: "presencial", confirmedByName: "Maria da Conceição" } });
    expect(detail.repairs).toHaveLength(1);
    expect(detail.testRounds).toHaveLength(1);
    expect(detail.delivery).toMatchObject({ pickedUpByName: "Maria da Conceição" });

    // A OS está fechada: nada mais entra, e a empresa vizinha não enxerga nada disso.
    expect((await upload(env, owner, orderId, "image/jpeg", JPEG)).statusCode).toBe(422);
    expect((await call(env, otherOwner, "GET", `/work-orders/${orderId}`)).statusCode).toBe(404);
    expect((await call(env, otherOwner, "GET", "/work-orders")).json().workOrders).toHaveLength(0);
    expect((await call(env, otherOwner, "GET", `/work-orders/${orderId}/documents/sheet`)).statusCode).toBe(404);
  });
});
