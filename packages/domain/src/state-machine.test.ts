import { describe, expect, it } from "vitest";
import {
  DIRECT_ACTIONS, isClosedForChanges, ruleFor, TERMINAL_STATES, TRANSITION_ACTIONS, TRANSITION_RULES, WORK_ORDER_STATES,
  type WorkOrderState,
} from "./index.js";

const edges = TRANSITION_RULES.flatMap((r) => r.from.map((from) => ({ from, to: r.to, action: r.action })));

describe("tabela de transições", () => {
  it("tem ações únicas e só estados conhecidos", () => {
    expect(new Set(TRANSITION_ACTIONS).size).toBe(TRANSITION_ACTIONS.length);
    for (const r of TRANSITION_RULES) {
      for (const state of [...r.from, r.to]) expect(WORK_ORDER_STATES, `${r.action}: ${state}`).toContain(state);
    }
  });

  it("a partir de RECEBIDA todo estado é alcançável", () => {
    const seen = new Set<WorkOrderState>(["RECEBIDA"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const edge of edges) {
        if (seen.has(edge.from) && !seen.has(edge.to)) {
          seen.add(edge.to);
          grew = true;
        }
      }
    }
    expect([...seen].sort()).toEqual([...WORK_ORDER_STATES].sort());
  });

  it("estados terminais não têm saída; ENTREGUE só vai para ENCERRADA", () => {
    for (const state of TERMINAL_STATES) expect(edges.filter((e) => e.from === state)).toEqual([]);
    expect(edges.filter((e) => e.from === "ENTREGUE").map((e) => e.to)).toEqual(["ENCERRADA"]);
  });

  it("todo par (estado, ação) fora da tabela é recusado", () => {
    const allowed = new Set(edges.map((e) => `${e.from}|${e.action}`));
    let rejected = 0;
    for (const state of WORK_ORDER_STATES) {
      for (const action of TRANSITION_ACTIONS) {
        const permitted = ruleFor(action)?.from.includes(state) ?? false;
        expect(permitted, `${state} + ${action}`).toBe(allowed.has(`${state}|${action}`));
        if (!permitted) rejected += 1;
      }
    }
    expect(rejected).toBeGreaterThan(100);
  });

  it("ação desconhecida não tem regra", () => {
    expect(ruleFor("apagar_tudo")).toBeUndefined();
  });

  it("exigem motivo: cancelar, liberar sem reparo, novo defeito, reprovar testes e reabrir (RN-004)", () => {
    const required = TRANSITION_RULES.filter((r) => r.reasonRequired).map((r) => r.action).sort();
    expect(required).toEqual([
      "cancelar", "liberar_sem_reparo", "liberar_sem_reparo_aguardando_peca", "novo_defeito",
      "reabrir_bancada", "reabrir_diagnostico", "reprovar_testes",
    ].sort());
  });

  it("só o sistema expira orçamento; atendente nunca muda estado pelo endpoint direto", () => {
    expect(ruleFor("expirar_orcamento")?.roles).toEqual([]);
    for (const action of DIRECT_ACTIONS) expect(ruleFor(action)?.roles, action).not.toContain("atendente");
  });

  it("apenas ações diretas ficam expostas; as da Fase 4 não", () => {
    expect(DIRECT_ACTIONS).toEqual(expect.arrayContaining(["iniciar_diagnostico", "cancelar", "peca_disponivel", "novo_defeito"]));
    for (const phase4 of ["iniciar_testes", "aprovar_testes", "entregar", "encerrar"]) expect(DIRECT_ACTIONS).not.toContain(phase4);
  });

  it("ENTREGUE e estados terminais fecham alterações", () => {
    expect(isClosedForChanges("ENTREGUE")).toBe(true);
    expect(isClosedForChanges("CANCELADA")).toBe(true);
    expect(isClosedForChanges("EM_REPARO")).toBe(false);
  });
});
