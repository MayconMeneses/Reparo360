import { schema, withContext } from "@reparo360/database";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";

/**
 * Técnicos ativos, só id e nome. Quem abre a OS (atendente) precisa escolher o técnico sem ter acesso
 * à gestão da equipe, então esta lista é separada e não traz e-mail nem papel.
 */
export function technicianRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/technicians", { preHandler: requireAuth(deps, { permission: "work_order.create" }) }, async (request) => {
      const auth = requireContext(request);
      const rows = await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, (db) =>
        db
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .where(and(eq(schema.memberships.tenantId, auth.tenantId), eq(schema.memberships.role, "tecnico"), eq(schema.memberships.status, "ativo")))
          .orderBy(asc(schema.users.name), asc(schema.users.id)));
      return { technicians: rows };
    });
  };
}
