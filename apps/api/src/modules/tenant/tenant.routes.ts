import { schema, withContext } from "@reparo360/database";
import { normalizePhone } from "@reparo360/domain";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { recordAudit } from "../../audit.js";
import { metaOf, requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";

const phone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) ctx.addIssue({ code: "custom", message: "Telefone inválido. Informe DDD e número." });
    return normalized ?? "";
  });

// Só dados de contato e de identificação. Status da empresa e e-mail administrativo não se alteram aqui
// (strictObject rejeita qualquer outro campo).
export const updateTenantBody = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    tradeName: z.string().trim().min(2).max(120).nullable().optional(),
    phone: phone.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Informe ao menos um campo." });

const dto = (row: typeof schema.tenants.$inferSelect) => ({
  id: row.id,
  name: row.name,
  tradeName: row.tradeName,
  phone: row.phone,
  adminEmail: row.adminEmail,
  status: row.status,
});

export function tenantRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/tenant", { preHandler: requireAuth(deps) }, async (request) => {
      const auth = requireContext(request);
      const [row] = await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, (db) =>
        db.select().from(schema.tenants).where(eq(schema.tenants.id, auth.tenantId)).limit(1));
      return dto(row as typeof schema.tenants.$inferSelect);
    });

    app.patch("/tenant", { preHandler: requireAuth(deps, { permission: "tenant.settings.write" }) }, async (request) => {
      const auth = requireContext(request);
      const body = updateTenantBody.parse(request.body);
      const meta = metaOf(request);
      return withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
        const [row] = await db
          .update(schema.tenants)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(schema.tenants.id, auth.tenantId))
          .returning();
        await recordAudit(db, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: "tenant_settings_updated", targetType: "tenant", targetId: auth.tenantId,
          outcome: "ok", correlationId: meta.correlationId, ip: meta.ip,
        });
        return dto(row as typeof schema.tenants.$inferSelect);
      });
    });
  };
}
