import { TENANT_ROLES } from "@reparo360/domain";
import { z } from "zod";

// .strict() em tudo: campo não declarado (tenantId, role, status...) é rejeitado,
// o que fecha o mass assignment.
const email = z.email().max(254).transform((value) => value.trim().toLowerCase());
const password = z.string().min(12, "A senha precisa ter ao menos 12 caracteres.").max(128);

export const loginBody = z.strictObject({
  email,
  password: z.string().min(1).max(128),
  tenantId: z.uuid().optional(),
});

export const reauthBody = z.strictObject({ password: z.string().min(1).max(128) });

export const onboardingBody = z.strictObject({
  tenantName: z.string().trim().min(2).max(120),
  tradeName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(8).max(30).optional(),
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: email,
  ownerPassword: password,
});

export const createMemberBody = z.strictObject({
  name: z.string().trim().min(2).max(120),
  email,
  password,
  role: z.enum(TENANT_ROLES),
});

export const updateMemberBody = z
  .strictObject({
    role: z.enum(TENANT_ROLES).optional(),
    status: z.enum(["ativo", "desativado"]).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, { message: "Informe papel ou status." });

export const memberParams = z.strictObject({ userId: z.uuid() });
