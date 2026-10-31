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

import { isKnownPath, titleFor } from "./routes";

describe("rotas e títulos", () => {
  it("reconhece só os endereços da interface", () => {
    const id = "334543e2-e613-4207-b017-5fc6e82ab949";
    for (const ok of ["/", "/ordens", `/ordens/${id}`, "/bancada", `/etiqueta/${id}`]) expect(isKnownPath(ok), ok).toBe(true);
    for (const bad of ["/nao-existe", "/ordens/abc", "/admin", `/ordens/${id}/x`]) expect(isKnownPath(bad), bad).toBe(false);
  });
  it("cada tela tem título próprio", () => {
    expect(titleFor("/ordens")).toBe("Ordens de serviço — Reparo360");
    expect(titleFor("/qualquer")).toBe("Página não encontrada — Reparo360");
    expect(new Set(["/", "/ordens", "/clientes", "/equipamentos", "/orcamentos", "/equipe", "/configuracoes", "/bancada"].map(titleFor)).size).toBe(8);
  });
});
