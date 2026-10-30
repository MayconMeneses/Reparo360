import { describe, expect, it } from "vitest";
import { formatProtocol, isValidImei, normalizePhone, protocolYear } from "./index.js";

describe("normalizePhone", () => {
  it("remove máscara e aceita 10 ou 11 dígitos", () => {
    expect(normalizePhone("(85) 99999-1234")).toBe("85999991234");
    expect(normalizePhone("85 3333-1234")).toBe("8533331234");
  });
  it("remove o DDI 55", () => {
    expect(normalizePhone("+55 85 99999-1234")).toBe("85999991234");
  });
  it("rejeita número curto, longo ou sem dígitos", () => {
    for (const bad of ["12345", "123456789012345", "abc", ""]) expect(normalizePhone(bad), bad).toBeNull();
  });
});

describe("isValidImei", () => {
  it("aceita IMEI com Luhn válido", () => {
    expect(isValidImei("490154203237518")).toBe(true);
  });
  it("rejeita dígito verificador errado, tamanho errado e letras", () => {
    expect(isValidImei("490154203237519")).toBe(false);
    expect(isValidImei("49015420323751")).toBe(false);
    expect(isValidImei("49015420323751a")).toBe(false);
  });
});

describe("protocolo", () => {
  it("formata com 6 dígitos", () => {
    expect(formatProtocol(2026, 123)).toBe("2026-000123");
    expect(formatProtocol(2026, 1)).toBe("2026-000001");
  });

  it("usa o ano de São Paulo na virada: 31/12 às 22h BRT já é janeiro em UTC", () => {
    expect(protocolYear(new Date("2027-01-01T01:00:00Z"))).toBe(2026);
    expect(protocolYear(new Date("2027-01-01T03:00:00Z"))).toBe(2027);
    expect(protocolYear(new Date("2026-12-31T23:59:59Z"))).toBe(2026);
  });
});
