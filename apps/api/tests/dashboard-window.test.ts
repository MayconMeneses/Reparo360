import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, loginOk, onboard, orderReadyForPickup, resetData, setupOrder, startTestEnv, transition, type Session, type TestEnv } from "./helpers.js";

// O dashboard só lê o histórico das OS com mudança de etapa DENTRO do período. Aqui se prova que isso não muda
// o resultado: passagens que começaram antes do período e terminaram nele continuam contando, e OS sem mudança
// no período não geram amostra. As datas dos eventos são deslocadas direto no banco (como superusuário, só no banco de teste).
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
let env: TestEnv;
let owner: Session;

beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetData(env.migrator);
  owner = await loginOk(env, (await onboard(env, "janela")).email);
});

function sql(statement: string) {
  const res = spawnSync("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", "reparo360_test", "-v", "ON_ERROR_STOP=1", "-q", "-c", statement], { cwd: root, encoding: "utf8" });
  if (res.status !== 0) throw new Error(res.stderr);
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
type Stage = { state: string; samples: number; medianSeconds: number };
async function stages(from: string, to: string): Promise<Record<string, Stage>> {
  const res = await call(env, owner, "GET", `/dashboard?from=${from}&to=${to}`);
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  const list = res.json<{ indicators: Array<{ id: string; values: Stage[] }> }>().indicators.find((i) => i.id === "tempo_por_etapa")?.values ?? [];
  return Object.fromEntries(list.map((s) => [s.state, s]));
}

describe("dashboard: tempo por etapa com janela de período", () => {
  it("passagem iniciada ANTES do período e terminada nele continua contando, com a duração inteira", async () => {
    const { orderId } = await orderReadyForPickup(env, owner);
    // A abertura (entrada em RECEBIDA) é empurrada 10 dias para trás; a saída para o diagnóstico fica hoje.
    sql(`UPDATE work_order_events SET created_at = created_at - interval '10 days' WHERE work_order_id = '${orderId}' AND type = 'os_aberta'`);
    const today = await stages(day(0), day(0));
    expect(today["RECEBIDA"]?.samples).toBe(1);
    expect(today["RECEBIDA"]!.medianSeconds).toBeGreaterThan(9.9 * 86_400);
    expect(today["RECEBIDA"]!.medianSeconds).toBeLessThan(10.1 * 86_400);
  });

  it("OS sem nenhuma mudança de etapa no período não gera amostra; com mudança, gera", async () => {
    const { orderId } = await orderReadyForPickup(env, owner);
    sql(`UPDATE work_order_events SET created_at = created_at - interval '60 days' WHERE work_order_id = '${orderId}'`);
    expect(await stages(day(0), day(0))).toEqual({});
    expect(await stages(day(-5), day(-1))).toEqual({});
    const past = await stages(day(-61), day(-59));
    expect(Object.keys(past).sort()).toEqual(["AGUARDANDO_APROVACAO", "EM_DIAGNOSTICO", "EM_REPARO", "EM_TESTE", "RECEBIDA"]);
    expect(Object.values(past).every((s) => s.samples === 1)).toBe(true);
  });

  it("período em que só parte das passagens terminou conta só essas", async () => {
    const { orderId } = await orderReadyForPickup(env, owner);
    // Primeira metade do histórico (até o início do reparo) 30 dias atrás; o resto hoje.
    sql(`UPDATE work_order_events SET created_at = created_at - interval '30 days' WHERE work_order_id = '${orderId}' AND type IN ('os_aberta', 'diagnostico_iniciado', 'orcamento_enviado')`);
    const recent = await stages(day(0), day(0));
    expect(recent["RECEBIDA"]).toBeUndefined(); // a saída de RECEBIDA foi há 30 dias
    expect(recent["EM_DIAGNOSTICO"]).toBeUndefined();
    expect(recent["AGUARDANDO_APROVACAO"]?.samples).toBe(1); // entrou há 30 dias, saiu hoje
    expect(recent["AGUARDANDO_APROVACAO"]!.medianSeconds).toBeGreaterThan(29.9 * 86_400);
    const old = await stages(day(-31), day(-29));
    expect(Object.keys(old).sort()).toEqual(["EM_DIAGNOSTICO", "RECEBIDA"]);
  });

  it("outra empresa nunca entra no cálculo", async () => {
    await orderReadyForPickup(env, owner);
    const other = await loginOk(env, (await onboard(env, "janelaB")).email);
    const order = await setupOrder(env, other);
    await transition(env, other, order.orderId, "cancelar", "Desistência");
    const res = await call(env, other, "GET", `/dashboard?from=${day(0)}&to=${day(0)}`);
    const values = res.json<{ indicators: Array<{ id: string; values: Stage[] }> }>().indicators.find((i) => i.id === "tempo_por_etapa")?.values ?? [];
    expect(values.map((s) => s.state)).toEqual(["RECEBIDA"]);
    expect(values[0]?.samples).toBe(1);
  });
});
