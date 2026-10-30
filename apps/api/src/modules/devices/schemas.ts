import { DEVICE_CATEGORIES, isValidImei } from "@reparo360/domain";
import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const imei = z.string().trim().refine(isValidImei, { message: "IMEI inválido (15 dígitos com dígito verificador)." });

const fields = {
  category: z.enum(DEVICE_CATEGORIES),
  brand: text(60),
  model: text(80),
  color: text(40),
  serialNumber: text(80),
  imei,
  notes: z.string().trim().max(1000),
};

export const createDeviceBody = z.strictObject({
  category: fields.category,
  brand: fields.brand,
  model: fields.model,
  color: fields.color.optional(),
  serialNumber: fields.serialNumber.optional(),
  imei: fields.imei.optional(),
  notes: fields.notes.optional(),
});

// customerId não é editável: troca de proprietário exige procedimento próprio (regra 10.2).
export const updateDeviceBody = z
  .strictObject({
    category: fields.category.optional(),
    brand: fields.brand.optional(),
    model: fields.model.optional(),
    color: fields.color.nullable().optional(),
    serialNumber: fields.serialNumber.nullable().optional(),
    imei: fields.imei.nullable().optional(),
    notes: fields.notes.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos um campo." });

export const deviceParams = z.strictObject({ deviceId: z.uuid() });
export const customerDevicesParams = z.strictObject({ customerId: z.uuid() });
