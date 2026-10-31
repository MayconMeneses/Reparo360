import { schema, withContext } from "@reparo360/database";
import { DEVICE_CATEGORIES, QUOTE_STATES } from "@reparo360/domain";
import { and, desc, eq, ilike, ne, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import { escapeLike, pagination } from "../shared/query.js";
import { visibleToActor } from "../work-orders/access.js";

const devicesQuery = z.strictObject({
  q: z.string().trim().min(1).max(80).optional(),
  category: z.enum(DEVICE_CATEGORIES).optional(),
  ...pagination,
});

const quotesQuery = z.strictObject({
  state: z.enum(QUOTE_STATES.filter((s) => s !== "rascunho") as [string, ...string[]]).optional(),
  ...pagination,
});

/** Listas de toda a assistência, usadas pelas telas de Equipamentos e Orçamentos. */
export function listRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/devices", { preHandler: requireAuth(deps, { permission: "device.read" }) }, async (request) => {
      const auth = requireContext(request);
      const query = devicesQuery.parse(request.query);
      const term = query.q ? `%${escapeLike(query.q)}%` : undefined;
      const rows = await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, (db) =>
        db
          .select({
            id: schema.devices.id, category: schema.devices.category, brand: schema.devices.brand, model: schema.devices.model,
            serialNumber: schema.devices.serialNumber, imei: schema.devices.imei, customerId: schema.devices.customerId, customerName: schema.customers.name,
          })
          .from(schema.devices)
          .innerJoin(schema.customers, and(eq(schema.customers.tenantId, schema.devices.tenantId), eq(schema.customers.id, schema.devices.customerId)))
          .where(and(
            eq(schema.devices.tenantId, auth.tenantId),
            query.category ? eq(schema.devices.category, query.category) : undefined,
            term ? or(ilike(schema.devices.brand, term), ilike(schema.devices.model, term), ilike(schema.devices.serialNumber, term), ilike(schema.customers.name, term)) : undefined,
          ))
          .orderBy(desc(schema.devices.createdAt), desc(schema.devices.id))
          .limit(query.limit)
          .offset(query.offset));
      return { devices: rows };
    });

    // Versões enviadas ou decididas (rascunho é trabalho em andamento e não entra na lista).
    app.get("/quotes", { preHandler: requireAuth(deps, { permission: "quote.read" }) }, async (request) => {
      const auth = requireContext(request);
      const query = quotesQuery.parse(request.query);
      const rows = await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, (db) =>
        db
          .select({
            id: schema.quoteVersions.id, number: schema.quoteVersions.number, state: schema.quoteVersions.state, totalCents: schema.quoteVersions.totalCents,
            validUntil: schema.quoteVersions.validUntil, submittedAt: schema.quoteVersions.submittedAt,
            workOrderId: schema.workOrders.id, protocol: schema.workOrders.protocol, customerName: schema.customers.name,
          })
          .from(schema.quoteVersions)
          .innerJoin(schema.workOrders, and(eq(schema.workOrders.tenantId, schema.quoteVersions.tenantId), eq(schema.workOrders.id, schema.quoteVersions.workOrderId)))
          .innerJoin(schema.customers, and(eq(schema.customers.tenantId, schema.workOrders.tenantId), eq(schema.customers.id, schema.workOrders.customerId)))
          .where(and(
            eq(schema.quoteVersions.tenantId, auth.tenantId),
            ne(schema.quoteVersions.state, "rascunho"),
            query.state ? eq(schema.quoteVersions.state, query.state) : undefined,
            visibleToActor(auth),
          ))
          .orderBy(desc(schema.quoteVersions.submittedAt), desc(schema.quoteVersions.id))
          .limit(query.limit)
          .offset(query.offset));
      return { quotes: rows };
    });
  };
}
