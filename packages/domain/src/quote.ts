import type { TenantRole } from "./roles.js";

export const QUOTE_STATES = ["rascunho", "enviado", "aprovado", "recusado", "expirado", "substituido"] as const;
export type QuoteState = (typeof QUOTE_STATES)[number];

export const QUOTE_ITEM_KINDS = ["peca", "servico"] as const;
export type QuoteItemKind = (typeof QUOTE_ITEM_KINDS)[number];

export const DIAGNOSTIC_NATURES = ["suspeita", "confirmado", "inconclusivo"] as const;
export type DiagnosticNature = (typeof DIAGNOSTIC_NATURES)[number];

// Limites que mantêm a soma dentro de inteiros seguros e barram valores absurdos.
export const MAX_QUOTE_ITEMS = 50;
export const MAX_ITEM_QUANTITY = 1000;
export const MAX_UNIT_PRICE_CENTS = 10_000_000; // R$ 100.000,00
/** P-11 (recomendação seguida): validade padrão de 7 dias. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 7;
export const MAX_QUOTE_VALIDITY_DAYS = 30;

export interface QuoteLine {
  quantity: number;
  unitPriceCents: number;
}

export interface QuoteTotals {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

export class QuoteError extends Error {
  constructor(readonly code: "ITEM_INVALIDO" | "DESCONTO_INVALIDO", message: string) {
    super(message);
    this.name = "QuoteError";
  }
}

/** Soma em centavos inteiros. O total nunca vem do cliente. */
export function computeTotals(lines: readonly QuoteLine[], discountCents: number): QuoteTotals {
  if (lines.length > MAX_QUOTE_ITEMS) throw new QuoteError("ITEM_INVALIDO", "Itens demais no orçamento.");
  let subtotalCents = 0;
  for (const line of lines) {
    const valid =
      Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= MAX_ITEM_QUANTITY &&
      Number.isInteger(line.unitPriceCents) && line.unitPriceCents >= 0 && line.unitPriceCents <= MAX_UNIT_PRICE_CENTS;
    if (!valid) throw new QuoteError("ITEM_INVALIDO", "Quantidade ou preço fora dos limites.");
    subtotalCents += line.quantity * line.unitPriceCents;
  }
  if (!Number.isInteger(discountCents) || discountCents < 0 || discountCents > subtotalCents) {
    throw new QuoteError("DESCONTO_INVALIDO", "O desconto não pode ser negativo nem maior que o subtotal.");
  }
  return { subtotalCents, discountCents, totalCents: subtotalCents - discountCents };
}

/**
 * P-10 (padrões da recomendação, ainda não configuráveis por empresa):
 * proprietário sem limite, gerente até 10%, atendente e técnico 0%.
 */
export function maxDiscountPercent(role: TenantRole): number {
  switch (role) {
    case "proprietario": return 100;
    case "gerente": return 10;
    default: return 0;
  }
}

/** Aritmética inteira: desconto/subtotal <= pct/100. */
export function discountAllowed(role: TenantRole, subtotalCents: number, discountCents: number): boolean {
  return discountCents * 100 <= subtotalCents * maxDiscountPercent(role);
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
