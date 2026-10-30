import { describe, expect, it } from "vitest";
import { addDays, computeTotals, discountAllowed, MAX_ITEM_QUANTITY, MAX_UNIT_PRICE_CENTS, QuoteError } from "./index.js";

describe("computeTotals", () => {
  it("soma em centavos inteiros e subtrai o desconto", () => {
    const totals = computeTotals([{ quantity: 2, unitPriceCents: 4590 }, { quantity: 1, unitPriceCents: 12000 }], 1000);
    expect(totals).toEqual({ subtotalCents: 21180, discountCents: 1000, totalCents: 20180 });
  });

  it("não sofre erro de ponto flutuante (0,1 + 0,2 em centavos)", () => {
    expect(computeTotals([{ quantity: 1, unitPriceCents: 10 }, { quantity: 1, unitPriceCents: 20 }], 0).totalCents).toBe(30);
    expect(computeTotals([{ quantity: 3, unitPriceCents: 1999 }], 0).totalCents).toBe(5997);
  });

  it("orçamento sem itens tem total zero e não aceita desconto", () => {
    expect(computeTotals([], 0).totalCents).toBe(0);
    expect(() => computeTotals([], 1)).toThrow(QuoteError);
  });

  it("rejeita desconto negativo, maior que o subtotal ou fracionário", () => {
    const lines = [{ quantity: 1, unitPriceCents: 1000 }];
    expect(computeTotals(lines, 1000).totalCents).toBe(0);
    for (const bad of [-1, 1001, 0.5]) expect(() => computeTotals(lines, bad), String(bad)).toThrow(QuoteError);
  });

  it("rejeita quantidade e preço fora dos limites ou não inteiros", () => {
    const bad = [
      { quantity: 0, unitPriceCents: 100 }, { quantity: -1, unitPriceCents: 100 }, { quantity: 1.5, unitPriceCents: 100 },
      { quantity: MAX_ITEM_QUANTITY + 1, unitPriceCents: 100 }, { quantity: 1, unitPriceCents: -1 },
      { quantity: 1, unitPriceCents: 9.99 }, { quantity: 1, unitPriceCents: MAX_UNIT_PRICE_CENTS + 1 },
      { quantity: Number.NaN, unitPriceCents: 100 },
    ];
    for (const line of bad) expect(() => computeTotals([line], 0), JSON.stringify(line)).toThrow(QuoteError);
  });

  it("no limite máximo continua dentro de inteiros seguros", () => {
    const lines = Array.from({ length: 50 }, () => ({ quantity: MAX_ITEM_QUANTITY, unitPriceCents: MAX_UNIT_PRICE_CENTS }));
    expect(Number.isSafeInteger(computeTotals(lines, 0).totalCents)).toBe(true);
    expect(() => computeTotals([...lines, lines[0] as (typeof lines)[number]], 0)).toThrow(QuoteError);
  });
});

describe("limite de desconto por papel (P-10)", () => {
  it("atendente e técnico: 0%; gerente: até 10% exatos; proprietário: até o subtotal", () => {
    expect(discountAllowed("atendente", 10000, 0)).toBe(true);
    expect(discountAllowed("atendente", 10000, 1)).toBe(false);
    expect(discountAllowed("tecnico", 10000, 1)).toBe(false);
    expect(discountAllowed("gerente", 10000, 1000)).toBe(true);
    expect(discountAllowed("gerente", 10000, 1001)).toBe(false);
    expect(discountAllowed("proprietario", 10000, 10000)).toBe(true);
  });

  it("usa aritmética inteira (sem arredondar para o lado do cliente)", () => {
    expect(discountAllowed("gerente", 999, 99)).toBe(true);
    expect(discountAllowed("gerente", 999, 100)).toBe(false);
  });
});

describe("addDays", () => {
  it("soma dias corridos", () => {
    expect(addDays(new Date("2026-10-30T12:00:00Z"), 7).toISOString()).toBe("2026-11-06T12:00:00.000Z");
  });
});
