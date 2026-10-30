import { schema, withContext } from "@reparo360/database";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import type { AppServices } from "../../services.js";
import { escapeLike } from "../shared/query.js";

export interface CustomerDto {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  createdAt: Date;
}

type CustomerRow = typeof schema.customers.$inferSelect;

const toDto = (row: CustomerRow): CustomerDto => ({
  id: row.id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  notes: row.notes,
  createdAt: row.createdAt,
});

const notFound = () => new HttpError(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");
const ctxOf = (auth: AuthContext) => ({ tenantId: auth.tenantId, userId: auth.userId });

export interface CreateCustomerInput {
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  confirmDuplicate?: boolean;
}

export async function createCustomer(deps: AppServices, auth: AuthContext, input: CreateCustomerInput): Promise<CustomerDto> {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    if (!input.confirmDuplicate) {
      const same = await db
        .select({ id: schema.customers.id, name: schema.customers.name })
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, auth.tenantId), eq(schema.customers.phone, input.phone)))
        .limit(5);
      if (same.length > 0) {
        throw new HttpError(409, "POSSIVEL_DUPLICIDADE", "Já existe cliente com este telefone.", { candidates: same });
      }
    }
    const [row] = await db
      .insert(schema.customers)
      .values({ tenantId: auth.tenantId, name: input.name, phone: input.phone, email: input.email, notes: input.notes })
      .returning();
    if (!row) throw new Error("insert de cliente não retornou linha");
    return toDto(row);
  });
}

export async function listCustomers(
  deps: AppServices,
  auth: AuthContext,
  query: { q?: string; limit: number; offset: number },
): Promise<CustomerDto[]> {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const digits = query.q?.replace(/\D/g, "") ?? "";
    const search = query.q
      ? or(ilike(schema.customers.name, `%${escapeLike(query.q)}%`), digits.length >= 4 ? ilike(schema.customers.phone, `${digits}%`) : undefined)
      : undefined;
    const rows = await db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, auth.tenantId), search))
      .orderBy(desc(schema.customers.createdAt), desc(schema.customers.id))
      .limit(query.limit)
      .offset(query.offset);
    return rows.map(toDto);
  });
}

export async function getCustomer(deps: AppServices, auth: AuthContext, customerId: string): Promise<CustomerDto> {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const [row] = await db
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, auth.tenantId), eq(schema.customers.id, customerId)))
      .limit(1);
    if (!row) throw notFound();
    return toDto(row);
  });
}

export interface UpdateCustomerInput {
  name?: string;
  phone?: string;
  email?: string | null;
  notes?: string | null;
}

export async function updateCustomer(
  deps: AppServices,
  auth: AuthContext,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<CustomerDto> {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const [row] = await db
      .update(schema.customers)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(schema.customers.tenantId, auth.tenantId), eq(schema.customers.id, customerId)))
      .returning();
    if (!row) throw notFound();
    return toDto(row);
  });
}
