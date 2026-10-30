import { MAX_ITEM_QUANTITY, MAX_QUOTE_ITEMS, MAX_QUOTE_VALIDITY_DAYS, MAX_UNIT_PRICE_CENTS, QUOTE_ITEM_KINDS } from "@reparo360/domain";
import { z } from "zod";

const item = z.strictObject({
  kind: z.enum(QUOTE_ITEM_KINDS),
  description: z.string().trim().min(2).max(200),
  quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
  unitPriceCents: z.number().int().min(0).max(MAX_UNIT_PRICE_CENTS),
});

// strictObject: totalCents, subtotalCents, state etc. enviados pelo cliente são rejeitados.
// Os totais são sempre calculados no servidor.
const content = {
  items: z.array(item).max(MAX_QUOTE_ITEMS),
  discountCents: z.number().int().min(0).max(MAX_UNIT_PRICE_CENTS * MAX_QUOTE_ITEMS).default(0),
  paymentTerms: z.string().trim().min(2).max(500).optional(),
  estimatedDays: z.number().int().min(1).max(365).optional(),
  notes: z.string().trim().min(1).max(1000).optional(),
};

export const createQuoteBody = z.strictObject(content);
/** Substitui TODO o conteúdo do rascunho (campos omitidos voltam a vazio). */
export const updateQuoteBody = z.strictObject({ ...content, revision: z.number().int().min(1) });

export const submitQuoteBody = z.strictObject({
  revision: z.number().int().min(1),
  validityDays: z.number().int().min(1).max(MAX_QUOTE_VALIDITY_DAYS).optional(),
  /** P-09: autoriza orçar sobre diagnóstico apenas suspeito. Fica registrado quem autorizou. */
  authorizeSuspicion: z.boolean().default(false),
});

export const decisionBody = z
  .strictObject({
    decision: z.enum(["aprovado", "recusado"]),
    /** Nome de quem decidiu pelo cliente (decisão presencial). */
    confirmedByName: z.string().trim().min(2).max(120),
    note: z.string().trim().min(1).max(500).optional(),
    partUnavailable: z.boolean().default(false),
  })
  .refine((value) => !(value.decision === "recusado" && value.partUnavailable), {
    message: "Peça indisponível só se aplica a uma aprovação.",
    path: ["partUnavailable"],
  });

export const quoteParams = z.strictObject({ quoteId: z.uuid() });
