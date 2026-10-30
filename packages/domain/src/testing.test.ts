import { describe, expect, it } from "vitest";
import { accessoriesDiffer, evaluateTestRound } from "./index.js";

describe("evaluateTestRound (RN-052)", () => {
  it("aprova quando há ao menos um aprovado e nada reprovado ou não testado", () => {
    expect(evaluateTestRound(["aprovado", "aprovado"]).approvable).toBe(true);
    expect(evaluateTestRound(["aprovado", "nao_aplicavel"]).approvable).toBe(true);
  });

  it("rodada vazia ou só de 'não se aplica' nunca aprova", () => {
    expect(evaluateTestRound([]).approvable).toBe(false);
    expect(evaluateTestRound(["nao_aplicavel", "nao_aplicavel"]).approvable).toBe(false);
  });

  it("item não testado impede a liberação", () => {
    const result = evaluateTestRound(["aprovado", "nao_testado"]);
    expect(result.approvable).toBe(false);
    expect(result.reasons).toContain("há item não testado");
  });

  it("item reprovado impede a liberação e sinaliza a volta à bancada", () => {
    const result = evaluateTestRound(["aprovado", "reprovado"]);
    expect(result).toMatchObject({ approvable: false, hasFailure: true });
    expect(evaluateTestRound(["aprovado"]).hasFailure).toBe(false);
  });
});

describe("accessoriesDiffer", () => {
  it("ignora caixa, espaços e ordem", () => {
    expect(accessoriesDiffer(["Carregador", " capa "], ["capa", "carregador"])).toBe(false);
  });
  it("detecta acessório faltando ou a mais", () => {
    expect(accessoriesDiffer(["carregador", "capa"], ["carregador"])).toBe(true);
    expect(accessoriesDiffer(["carregador"], ["carregador", "cabo"])).toBe(true);
    expect(accessoriesDiffer([], [])).toBe(false);
  });
});
