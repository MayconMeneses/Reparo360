import { normalizePhone } from "@reparo360/domain";
import { z } from "zod";
import { pagination } from "../shared/query.js";

const phone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) ctx.addIssue({ code: "custom", message: "Telefone inválido. Informe DDD e número." });
    return normalized ?? "";
  });
const email = z.email().max(254).transform((value) => value.trim().toLowerCase());
const name = z.string().trim().min(2).max(120);
const notes = z.string().trim().max(1000);

export const createCustomerBody = z.strictObject({
  name,
  phone,
  email: email.optional(),
  notes: notes.optional(),
  /** Confirma o cadastro mesmo havendo cliente com o mesmo telefone (sem fusão automática). */
  confirmDuplicate: z.boolean().optional(),
});

export const updateCustomerBody = z
  .strictObject({ name: name.optional(), phone: phone.optional(), email: email.nullable().optional(), notes: notes.nullable().optional() })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos um campo." });

export const listCustomersQuery = z.strictObject({
  q: z.string().trim().min(1).max(80).optional(),
  ...pagination,
});

export const customerParams = z.strictObject({ customerId: z.uuid() });
