import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addMember, call, decisionBody, deliver, diagnose, loginOk, onboard, orderInDiagnosis, orderInRepair, orderReadyForPickup, resetData,
  sendQuote, setupOrder, startTestEnv, transition, type Session, type TestEnv,
} from "./helpers.js";

let env: TestEnv;
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
  ownerA = await loginOk(env, (await onboard(env, "dashA")).email);
  ownerB = await loginOk(env, (await onboard(env, "dashB")).email);
});

type Indicator = { id: string; unit: string; source: string; formula: string; includes: string; excludes: string; scope: string; values: unknown };
const indicators = async (session: Session, query = "") => {
  const res = await call(env, session, "GET", `/dashboard${query}`);
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  const body = res.json<{ period: Record<string, string>; indicators: Indicator[] }>();
  return { body, by: (id: string) => body.indicators.find((i) => i.id === id)?.values };
};

/**
 * Cenário semeado, com os números calculados à mão ANTES de escrever as consultas:
 *  O1 entregue            (passou por RECEBIDA, DIAGNOSTICO, APROVACAO, REPARO, TESTE, PRONTA_RETIRADA; orçamento aprovado)
 *  O2 em reparo           (RECEBIDA, DIAGNOSTICO, APROVACAO passadas; orçamento aprovado; ainda em REPARO)
 *  O3 recebida            (nenhuma etapa concluída)
 *  O4 cancelada           (saiu de RECEBIDA para CANCELADA)
 *  O5 orçamento recusado  (RECEBIDA, DIAGNOSTICO, APROVACAO passadas; está em PRONTA_RETIRADA_SEM_REPARO)
 */
async function seed() {
  const o1 = await orderReadyForPickup(env, ownerA);
  await deliver(env, ownerA, o1.orderId);
  await orderInRepair(env, ownerA);
  await setupOrder(env, ownerA);
  const o4 = await setupOrder(env, ownerA);
  await transition(env, ownerA, o4.orderId, "cancelar", "Cliente desistiu");
  const o5 = await orderInDiagnosis(env, ownerA);
  await diagnose(env, o5.techSession, o5.orderId);
  const sent = await sendQuote(env, ownerA, o5.orderId);
  await call(env, ownerA, "POST", `/quotes/${sent.id}/decision`, decisionBody({ decision: "recusado" }));
}

describe("indicadores (números do cenário semeado)", () => {
  it("contagens atuais e do período batem com o cálculo manual", async () => {
    await seed();
    const { by } = await indicators(ownerA);
    expect(by("os_abertas")).toBe(3); // O2, O3, O5
    expect(by("por_estado")).toMatchObject({ EM_REPARO: 1, RECEBIDA: 1, PRONTA_RETIRADA_SEM_REPARO: 1, EM_DIAGNOSTICO: 0, PRONTA_RETIRADA: 0 });
    expect(by("recebidas_periodo")).toBe(5);
    expect(by("entregues_periodo")).toBe(1); // O1
    expect(by("orcamentos_decididos")).toEqual({ aprovado: 2, recusado: 1 }); // O1 e O2 aprovados; O5 recusado
    expect(by("servicos_por_categoria")).toEqual({ celular: 4 }); // O1, O2, O3, O5 (O4 cancelada fora)
  });

  it("tempo por etapa: cada passagem concluída conta uma amostra; a etapa atual não conta", async () => {
    await seed();
    const { by } = await indicators(ownerA);
    const stages = Object.fromEntries((by("tempo_por_etapa") as Array<{ state: string; samples: number }>).map((s) => [s.state, s.samples]));
    expect(stages).toEqual({
      RECEBIDA: 4, // O1, O2, O5 seguiram para diagnóstico; O4 saiu para CANCELADA (O3 ainda está nela)
      EM_DIAGNOSTICO: 3, // O1, O2, O5 enviaram o orçamento
      AGUARDANDO_APROVACAO: 3, // O1, O2, O5 foram decididos
      EM_REPARO: 1, // só O1 saiu do reparo (O2 ainda está nele)
      EM_TESTE: 1, // O1
      PRONTA_RETIRADA: 1, // O1 foi entregue
    });
  });

  it("cada indicador informa fonte, fórmula, unidade, o que entra e o que não entra (spec 20.2)", async () => {
    const { body } = await indicators(ownerA);
    expect(body.indicators.map((i) => i.id)).toEqual([
      "os_abertas", "por_estado", "recebidas_periodo", "entregues_periodo", "orcamentos_decididos", "tempo_por_etapa", "servicos_por_categoria",
    ]);
    for (const i of body.indicators) {
      for (const field of ["unit", "source", "formula", "includes", "excludes", "scope"] as const) expect(i[field], `${i.id}.${field}`).toBeTruthy();
    }
  });

  it("nunca apresenta orçamento como faturamento", async () => {
    await seed();
    const res = await call(env, ownerA, "GET", "/dashboard");
    const { indicators: list } = res.json<{ indicators: Indicator[] }>();
    // Rótulos, unidades e valores nunca falam em receita; o texto "excludes" pode (é o aviso de que NÃO é faturamento).
    for (const i of list) {
      expect(`${i.id} ${i.unit} ${(i as unknown as { label: string }).label}`.toLowerCase(), i.id).not.toMatch(/faturamento|receita|recebido|valor/);
      expect(JSON.stringify(i.values), i.id).not.toMatch(/Cents|reais/i);
    }
    expect(res.body).not.toMatch(/totalCents|subtotalCents/);
    expect(list.find((i) => i.id === "orcamentos_decididos")?.excludes).toContain("nunca valor ou faturamento");
  });
});

describe("período (America/Sao_Paulo)", () => {
  it("dia futuro e dia passado não têm OS recebidas, mas a situação atual continua valendo", async () => {
    await seed();
    const past = await indicators(ownerA, "?from=2020-01-01&to=2020-01-02");
    expect(past.by("recebidas_periodo")).toBe(0);
    expect(past.by("entregues_periodo")).toBe(0);
    expect(past.by("orcamentos_decididos")).toEqual({ aprovado: 0, recusado: 0 });
    expect(past.by("os_abertas")).toBe(3);
    const future = await indicators(ownerA, "?from=2999-01-01&to=2999-01-02");
    expect(future.by("recebidas_periodo")).toBe(0);
  });

  it("devolve o intervalo em UTC com início inclusivo e fim exclusivo (UTC-03:00)", async () => {
    const { body } = await indicators(ownerA, "?from=2026-11-10&to=2026-11-10");
    expect(body.period).toMatchObject({ from: "2026-11-10", to: "2026-11-10", timezone: "America/Sao_Paulo", startUtc: "2026-11-10T03:00:00.000Z", endExclusiveUtc: "2026-11-11T03:00:00.000Z" });
  });

  it("rejeita período invertido, grande demais e datas inválidas", async () => {
    for (const bad of ["?from=2026-11-10&to=2026-11-01", "?from=2024-01-01&to=2026-11-01", "?from=ontem", "?from=2026-13-45&to=2026-13-46"]) {
      expect((await call(env, ownerA, "GET", `/dashboard${bad}`)).statusCode, bad).toBe(400);
    }
  });
});

describe("acesso e isolamento", () => {
  it("só proprietário e gerente; outra empresa enxerga apenas os próprios números", async () => {
    await seed();
    const manager = await loginOk(env, (await addMember(env, ownerA, "gerente")).email);
    const clerk = await loginOk(env, (await addMember(env, ownerA, "atendente")).email);
    const tech = await loginOk(env, (await addMember(env, ownerA, "tecnico")).email);
    expect((await call(env, manager, "GET", "/dashboard")).statusCode).toBe(200);
    expect((await call(env, clerk, "GET", "/dashboard")).statusCode).toBe(403);
    expect((await call(env, tech, "GET", "/dashboard")).statusCode).toBe(403);
    expect((await call(env, null, "GET", "/dashboard")).statusCode).toBe(401);
    const b = await indicators(ownerB);
    expect(b.by("os_abertas")).toBe(0);
    expect(b.by("recebidas_periodo")).toBe(0);
    expect(b.by("servicos_por_categoria")).toEqual({});
    expect(b.by("tempo_por_etapa")).toEqual([]);
  });
});
