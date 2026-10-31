import { describe, expect, it } from "vitest";
import { formatBrl, stateLabel, tokenFromHash } from "./format";

describe("formatBrl", () => {
  it("formata centavos inteiros", () => {
    expect(formatBrl(0)).toBe("R$ 0,00");
    expect(formatBrl(5)).toBe("R$ 0,05");
    expect(formatBrl(23180)).toBe("R$ 231,80");
    expect(formatBrl(123456789)).toBe("R$ 1.234.567,89");
  });
  it("valor inválido vira travessão, nunca um número errado", () => {
    for (const bad of [-1, 1.5, Number.NaN]) expect(formatBrl(bad)).toBe("—");
  });
});

describe("stateLabel", () => {
  it("traduz os estados e devolve o código se for desconhecido", () => {
    expect(stateLabel("EM_REPARO")).toBe("Em reparo");
    expect(stateLabel("OUTRO")).toBe("OUTRO");
  });
});

describe("tokenFromHash (link do consumidor)", () => {
  const token = "A".repeat(43);
  it("lê o token do fragmento", () => {
    expect(tokenFromHash(`#t=${token}`)).toBe(token);
  });
  it("recusa formatos inesperados", () => {
    for (const bad of ["", "#", "#t=", "#t=curto", `#x=${token}`, `#t=${token}&y=1`, `t=${token}`, `#t=${token}<script>`]) {
      expect(tokenFromHash(bad), bad).toBeNull();
    }
  });
});
