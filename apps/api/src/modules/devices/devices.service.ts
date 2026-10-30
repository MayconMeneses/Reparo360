import { schema, withContext } from "@reparo360/database";
import type { DeviceCategory } from "@reparo360/domain";
import { and, asc, eq } from "drizzle-orm";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import type { AppServices } from "../../services.js";

export interface DeviceDto {
  id: string;
  customerId: string;
  category: DeviceCategory;
  brand: string;
  model: string;
  color: string | null;
  serialNumber: string | null;
  imei: string | null;
  notes: string | null;
}

type DeviceRow = typeof schema.devices.$inferSelect;

export const toDeviceDto = (row: DeviceRow): DeviceDto => ({
  id: row.id,
  customerId: row.customerId,
  category: row.category as DeviceCategory,
  brand: row.brand,
  model: row.model,
  color: row.color,
  serialNumber: row.serialNumber,
  imei: row.imei,
  notes: row.notes,
});

const ctxOf = (auth: AuthContext) => ({ tenantId: auth.tenantId, userId: auth.userId });
const customerNotFound = () => new HttpError(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");
const deviceNotFound = () => new HttpError(404, "EQUIPAMENTO_NAO_ENCONTRADO", "Equipamento não encontrado.");

export interface DeviceInput {
  category: DeviceCategory;
  brand: string;
  model: string;
  color?: string;
  serialNumber?: string;
  imei?: string;
  notes?: string;
}

export async function createDevice(deps: AppServices, auth: AuthContext, customerId: string, input: DeviceInput): Promise<DeviceDto> {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const [customer] = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, auth.tenantId), eq(schema.customers.id, customerId)))
      .limit(1);
    if (!customer) throw customerNotFound();
    const [row] = await db.insert(schema.devices).values({ ...input, tenantId: auth.tenantId, customerId }).returning();
    if (!row) throw new Error("insert de equipamento não retornou linha");
    return toDeviceDto(row);
  });
}

export async function listDevices(deps: AppServices, auth: AuthContext, customerId: string): Promise<DeviceDto[]> {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const [customer] = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, auth.tenantId), eq(schema.customers.id, customerId)))
      .limit(1);
    if (!customer) throw customerNotFound();
    const rows = await db
      .select()
      .from(schema.devices)
      .where(and(eq(schema.devices.tenantId, auth.tenantId), eq(schema.devices.customerId, customerId)))
      .orderBy(asc(schema.devices.createdAt), asc(schema.devices.id))
      .limit(100);
    return rows.map(toDeviceDto);
  });
}

export type DeviceUpdate = Partial<Omit<DeviceInput, "color" | "serialNumber" | "imei" | "notes">> & {
  color?: string | null;
  serialNumber?: string | null;
  imei?: string | null;
  notes?: string | null;
};

export async function updateDevice(deps: AppServices, auth: AuthContext, deviceId: string, input: DeviceUpdate): Promise<DeviceDto> {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const [row] = await db
      .update(schema.devices)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(schema.devices.tenantId, auth.tenantId), eq(schema.devices.id, deviceId)))
      .returning();
    if (!row) throw deviceNotFound();
    return toDeviceDto(row);
  });
}
