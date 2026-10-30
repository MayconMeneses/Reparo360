import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember, call, goodRepair, loginOk, onboard, orderDetail, orderInDiagnosis, orderInRepair, passingTests, repairAndStartTests,
  resetData, startTestEnv, transition, type Account, type Session, type TestEnv,
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
  a = await onboard(env, "bancadaA");
  const b = await onboard(env, "bancadaB");
  ownerA = await loginOk(env, a.email);
  ownerB = await loginOk(env, b.email);
});

const tests = (session: Session, orderId: string, body: object) => call(env, session, "POST", `/work-orders/${orderId}/test-checks`, body);
const repair = (session: Session, orderId: string, body: object = goodRepair()) => call(env, session, "POST", `/work-orders/${orderId}/repairs`, body);

describe("registro do reparo", () => {
  it("só com a OS em reparo; grava procedimento, peças e resultado presos ao ciclo", async () => {
    const early = await orderInDiagnosis(env, ownerA);
    const wrongState = await repair(early.techSession, early.orderId);
    expect(wrongState.statusCode).toBe(422);
    expect(wrongState.json().error.code).toBe("OS_FORA_DE_REPARO");

    const { orderId, techSession } = await orderInRepair(env, ownerA);
    const ok = await repair(techSession, orderId, goodRepair({ partsUsed: "Bateria 3000 mAh", notes: "Contatos oxidados" }));
    expect(ok.statusCode).toBe(201);
    expect(ok.json().cycle).toBe(1);
    const detail = await orderDetail(env, ownerA, orderId);
    expect(detail.repairs).toHaveLength(1);
    expect(detail.repairs[0]).toMatchObject({ procedure: "Troca de bateria e limpeza dos contatos", partsUsed: "Bateria 3000 mAh", outcome: "concluido" });
    expect(detail.events.map((e: { type: string }) => e.type)).toContain("reparo_registrado");
  });

  it("valida o desfecho e rejeita campos desconhecidos; atendente não registra; outra empresa recebe 404", async () => {
    const { orderId, techSession } = await orderInRepair(env, ownerA);
    expect((await repair(techSession, orderId, goodRepair({ outcome: "talvez" }))).statusCode).toBe(400);
    expect((await repair(techSession, orderId, goodRepair({ cycle: 9 }))).statusCode).toBe(400);
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    expect((await repair(clerk, orderId)).statusCode).toBe(403);
    expect((await repair(ownerB, orderId)).statusCode).toBe(404);
    const stranger = await loginOk(env, (await addMember(env, ownerA, "tecnico", "alheio")).email);
    expect((await repair(stranger, orderId)).statusCode).toBe(404);
  });
});

describe("iniciar testes", () => {
  it("exige ao menos uma tarefa de reparo; com ela, abre o ciclo de testes", async () => {
    const { orderId, techSession } = await orderInRepair(env, ownerA);
    const without = await transition(env, techSession, orderId, "iniciar_testes");
    expect(without.statusCode).toBe(422);
    expect(without.json().error.code).toBe("SEM_REPARO_REGISTRADO");
    await repair(techSession, orderId);
    const started = await transition(env, techSession, orderId, "iniciar_testes");
    expect(started.json().state).toBe("EM_TESTE");
    expect((await orderDetail(env, ownerA, orderId)).testCycle).toBe(1);
  });
});

describe("testes finais (RN-052)", () => {
  const inTest = async () => {
    const order = await orderInRepair(env, ownerA);
    await repairAndStartTests(env, order.techSession, order.orderId);
    return order;
  };

  it("só são registrados com a OS em teste", async () => {
    const { orderId, techSession } = await orderInRepair(env, ownerA);
    const res = await tests(techSession, orderId, passingTests());
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("OS_FORA_DE_TESTE");
  });

  it("não libera sem testes, com item não testado, só 'não se aplica' ou com reprovado", async () => {
    const { orderId, techSession } = await inTest();
    const approve = () => transition(env, techSession, orderId, "aprovar_testes");
    expect((await approve()).json().error.code).toBe("TESTES_NAO_APROVAVEIS");
    await tests(techSession, orderId, { items: [{ item: "Carga", result: "aprovado" }, { item: "Tela", result: "nao_testado" }] });
    expect((await approve()).json().error.details.reasons).toContain("há item não testado");
    await tests(techSession, orderId, { items: [{ item: "Carga", result: "nao_aplicavel" }] });
    expect((await approve()).json().error.details.reasons).toContain("nenhum item aprovado");
    await tests(techSession, orderId, { items: [{ item: "Carga", result: "aprovado" }, { item: "Tela", result: "reprovado" }] });
    expect((await approve()).json().error.details.reasons).toContain("há item reprovado");
    expect((await orderDetail(env, ownerA, orderId)).state).toBe("EM_TESTE");
  });

  it("vale a última rodada do ciclo; as anteriores ficam no histórico", async () => {
    const { orderId, techSession } = await inTest();
    const first = await tests(techSession, orderId, { items: [{ item: "Carga", result: "reprovado" }] });
    expect(first.json()).toMatchObject({ round: 1, approvable: false, hasFailure: true });
    const second = await tests(techSession, orderId, passingTests());
    expect(second.json()).toMatchObject({ round: 2, approvable: true });
    expect((await transition(env, techSession, orderId, "aprovar_testes")).json().state).toBe("PRONTA_RETIRADA");
    const rounds = (await orderDetail(env, ownerA, orderId)).testRounds as Array<{ round: number }>;
    expect(rounds.map((r) => r.round)).toEqual([2, 1]);
  });

  it("reprovar exige item reprovado e motivo, e devolve a OS à bancada em um novo ciclo de reparo", async () => {
    const { orderId, techSession } = await inTest();
    await tests(techSession, orderId, passingTests());
    expect((await transition(env, techSession, orderId, "reprovar_testes", "Falhou")).json().error.code).toBe("SEM_ITEM_REPROVADO");
    await tests(techSession, orderId, { items: [{ item: "Carga", result: "reprovado", note: "Não segura carga" }] });
    expect((await transition(env, techSession, orderId, "reprovar_testes")).json().error.code).toBe("MOTIVO_OBRIGATORIO");
    const back = await transition(env, techSession, orderId, "reprovar_testes", "Carga não se mantém");
    expect(back.json().state).toBe("EM_REPARO");
    expect((await orderDetail(env, ownerA, orderId)).repairCycle).toBe(2);
  });

  it("ciclo novo exige novo reparo e novos testes: nada do ciclo anterior vale", async () => {
    const { orderId, techSession } = await inTest();
    await tests(techSession, orderId, { items: [{ item: "Carga", result: "reprovado" }] });
    await transition(env, techSession, orderId, "reprovar_testes", "Reprovado no primeiro ciclo");
    // O reparo do ciclo 1 não vale para o ciclo 2.
    expect((await transition(env, techSession, orderId, "iniciar_testes")).json().error.code).toBe("SEM_REPARO_REGISTRADO");
    await repair(techSession, orderId, goodRepair({ procedure: "Segunda intervenção na placa" }));
    expect((await transition(env, techSession, orderId, "iniciar_testes")).statusCode).toBe(200);
    // A rodada reprovada do ciclo 1 não vale; sem rodada nova, não aprova.
    expect((await transition(env, techSession, orderId, "aprovar_testes")).json().error.code).toBe("TESTES_NAO_APROVAVEIS");
  });

  it("reabrir a bancada depois de aprovado: uma rodada aprovada antiga NÃO libera o novo ciclo", async () => {
    const { orderId, techSession } = await inTest();
    await tests(techSession, orderId, passingTests());
    await transition(env, techSession, orderId, "aprovar_testes");
    expect((await transition(env, ownerA, orderId, "reabrir_bancada")).json().error.code).toBe("MOTIVO_OBRIGATORIO");
    expect((await transition(env, ownerA, orderId, "reabrir_bancada", "Cliente voltou com o defeito")).json().state).toBe("EM_REPARO");
    await repair(techSession, orderId, goodRepair({ procedure: "Nova intervenção após retorno" }));
    await transition(env, techSession, orderId, "iniciar_testes");
    const stale = await transition(env, techSession, orderId, "aprovar_testes");
    expect(stale.statusCode).toBe(422);
    expect(stale.json().error.code).toBe("TESTES_NAO_APROVAVEIS");
    expect((await orderDetail(env, ownerA, orderId)).state).toBe("EM_TESTE");
  });

  it("itens repetidos, resultado fora da lista e lista vazia são rejeitados", async () => {
    const { orderId, techSession } = await inTest();
    expect((await tests(techSession, orderId, { items: [] })).statusCode).toBe(400);
    expect((await tests(techSession, orderId, { items: [{ item: "Carga", result: "ok" }] })).statusCode).toBe(400);
    expect((await tests(techSession, orderId, { items: [{ item: "Carga", result: "aprovado" }, { item: "carga", result: "reprovado" }] })).statusCode).toBe(400);
  });

  it("papéis: atendente não registra testes nem libera; outra empresa recebe 404", async () => {
    const { orderId, techSession } = await inTest();
    await tests(techSession, orderId, passingTests());
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    expect((await tests(clerk, orderId, passingTests())).statusCode).toBe(403);
    expect((await transition(env, clerk, orderId, "aprovar_testes")).statusCode).toBe(403);
    expect((await tests(ownerB, orderId, passingTests())).statusCode).toBe(404);
  });
});
