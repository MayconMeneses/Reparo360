import { describe, expect, it } from "vitest";
import { computeStageDurations, median, OPEN_STATES, WORK_ORDER_STATES, type StateEvent } from "./index.js";

const at = (iso: string) => new Date(iso);
const ev = (workOrderId: string, fromState: StateEvent["fromState"], toState: StateEvent["toState"], when: string): StateEvent => ({ workOrderId, fromState, toState, at: at(when) });
const FROM = at("2026-11-01T03:00:00Z");
const TO = at("2026-12-01T03:00:00Z");

describe("median", () => {
  it("ímpar, par, vazia e um elemento", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
  });
});

describe("computeStageDurations (números calculados à mão)", () => {
  // OS A: recebida 08:00 -> diagnóstico 09:00 (1h na RECEBIDA) -> aguarda aprovação 11:00 (2h em diagnóstico)
  // OS B: recebida 08:00 -> diagnóstico 08:30 (30min) -> aguarda aprovação 09:30 (1h) -> diagnóstico 10:00 (30min em aprovação)
  //       -> aguarda aprovação 12:00 (2h no SEGUNDO diagnóstico). Passa duas vezes pelo diagnóstico.
  // OS C: recebida 08:00 -> diagnóstico 10:00 (2h) e ainda está lá (etapa aberta: não conta)
  const events = [
    ev("A", null, "RECEBIDA", "2026-11-10T08:00:00Z"),
    ev("A", "RECEBIDA", "EM_DIAGNOSTICO", "2026-11-10T09:00:00Z"),
    ev("A", "EM_DIAGNOSTICO", "AGUARDANDO_APROVACAO", "2026-11-10T11:00:00Z"),
    ev("B", null, "RECEBIDA", "2026-11-10T08:00:00Z"),
    ev("B", "RECEBIDA", "EM_DIAGNOSTICO", "2026-11-10T08:30:00Z"),
    ev("B", "EM_DIAGNOSTICO", "AGUARDANDO_APROVACAO", "2026-11-10T09:30:00Z"),
    ev("B", "AGUARDANDO_APROVACAO", "EM_DIAGNOSTICO", "2026-11-10T10:00:00Z"),
    ev("B", "EM_DIAGNOSTICO", "AGUARDANDO_APROVACAO", "2026-11-10T12:00:00Z"),
    ev("C", null, "RECEBIDA", "2026-11-10T08:00:00Z"),
    ev("C", "RECEBIDA", "EM_DIAGNOSTICO", "2026-11-10T10:00:00Z"),
  ];
  const by = (state: string) => computeStageDurations(events, FROM, TO).find((d) => d.state === state);

  it("RECEBIDA: amostras de 1h (A), 30min (B) e 2h (C) -> mediana 1h", () => {
    expect(by("RECEBIDA")).toEqual({ state: "RECEBIDA", samples: 3, medianSeconds: 3600 });
  });

  it("EM_DIAGNOSTICO: A 2h, B 1h e B de novo 2h -> 3 amostras (cada passagem conta) e mediana 2h; C não entra", () => {
    expect(by("EM_DIAGNOSTICO")).toEqual({ state: "EM_DIAGNOSTICO", samples: 3, medianSeconds: 7200 });
  });

  it("AGUARDANDO_APROVACAO: só a passagem fechada de B (30min)", () => {
    expect(by("AGUARDANDO_APROVACAO")).toEqual({ state: "AGUARDANDO_APROVACAO", samples: 1, medianSeconds: 1800 });
  });

  it("passagens que terminaram fora do período não entram", () => {
    const result = computeStageDurations(events, at("2026-11-11T03:00:00Z"), TO);
    expect(result).toEqual([]);
    const narrow = computeStageDurations(events, at("2026-11-10T08:45:00Z"), at("2026-11-10T09:15:00Z"));
    // Janela 08:45-09:15: só a saída da RECEBIDA da OS A (09:00, 1h) cai dentro.
    expect(narrow).toEqual([{ state: "RECEBIDA", samples: 1, medianSeconds: 3600 }]);
  });

  it("a saída no limite superior (exclusivo) não entra; no inferior entra", () => {
    const e = [ev("A", null, "RECEBIDA", "2026-11-10T08:00:00Z"), ev("A", "RECEBIDA", "EM_DIAGNOSTICO", "2026-11-10T09:00:00Z")];
    expect(computeStageDurations(e, at("2026-11-10T09:00:00Z"), at("2026-11-10T10:00:00Z"))).toHaveLength(1);
    expect(computeStageDurations(e, at("2026-11-10T08:00:00Z"), at("2026-11-10T09:00:00Z"))).toHaveLength(0);
  });

  it("evento de saída sem entrada conhecida (histórico incompleto) é ignorado, sem estourar", () => {
    expect(computeStageDurations([ev("Z", "EM_REPARO", "EM_TESTE", "2026-11-10T09:00:00Z")], FROM, TO)).toEqual([]);
  });
});

describe("OPEN_STATES", () => {
  it("são todos os estados exceto entregue, encerrada e cancelada", () => {
    expect([...OPEN_STATES].sort()).toEqual(WORK_ORDER_STATES.filter((s) => !["ENTREGUE", "ENCERRADA", "CANCELADA"].includes(s)).sort());
  });
});
