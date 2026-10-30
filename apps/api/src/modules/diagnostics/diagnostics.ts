import { schema, withContext, type Db } from "@reparo360/database";
import { DIAGNOSTIC_NATURES } from "@reparo360/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import { metaOf, requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import { addEvent, loadOrderForActor } from "../work-orders/access.js";
import { workOrderParams } from "../work-orders/schemas.js";

const text = (max: number) => z.string().trim().min(1).max(max);

// Suspeita e confirmado precisam informar o defeito; só o inconclusivo pode omitir.
export const diagnosticBody = z
  .strictObject({
    nature: z.enum(DIAGNOSTIC_NATURES),
    symptoms: text(2000),
    checksPerformed: text(2000),
    findings: text(2000).optional(),
    recommendedServices: text(2000).optional(),
    notes: text(2000).optional(),
  })
  .refine((value) => value.nature === "inconclusivo" || value.findings !== undefined, {
    message: "Informe o defeito identificado (ou marque o diagnóstico como inconclusivo).",
    path: ["findings"],
  });
export type DiagnosticInput = z.infer<typeof diagnosticBody>;

type DiagnosticRow = typeof schema.diagnostics.$inferSelect;

export const diagnosticDto = (row: DiagnosticRow) => ({
  id: row.id,
  revision: row.revision,
  nature: row.nature,
  symptoms: row.symptoms,
  checksPerformed: row.checksPerformed,
  findings: row.findings,
  recommendedServices: row.recommendedServices,
  notes: row.notes,
  authorId: row.authorId,
  createdAt: row.createdAt,
});

export async function listDiagnostics(db: Db, tenantId: string, orderId: string) {
  const rows = await db
    .select()
    .from(schema.diagnostics)
    .where(and(eq(schema.diagnostics.tenantId, tenantId), eq(schema.diagnostics.workOrderId, orderId)))
    .orderBy(desc(schema.diagnostics.revision));
  return rows.map(diagnosticDto);
}

async function recordDiagnostic(deps: AppServices, auth: AuthContext, orderId: string, input: DiagnosticInput, correlationId: string, ip: string) {
  return withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
    const order = await loadOrderForActor(db, auth, orderId, true);
    if (order.state !== "EM_DIAGNOSTICO") {
      throw new HttpError(422, "OS_FORA_DE_DIAGNOSTICO", "Só é possível registrar diagnóstico com a OS em diagnóstico.");
    }
    const [last] = await db
      .select({ revision: sql<number>`coalesce(max(${schema.diagnostics.revision}), 0)::int` })
      .from(schema.diagnostics)
      .where(and(eq(schema.diagnostics.tenantId, auth.tenantId), eq(schema.diagnostics.workOrderId, order.id)));
    const [row] = await db
      .insert(schema.diagnostics)
      .values({ ...input, tenantId: auth.tenantId, workOrderId: order.id, revision: (last?.revision ?? 0) + 1, authorId: auth.userId })
      .returning();
    if (!row) throw new Error("insert de diagnóstico não retornou linha");
    await addEvent(db, { tenantId: auth.tenantId, workOrderId: order.id, type: "diagnostico_registrado", actorUserId: auth.userId });
    await recordAudit(db, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "diagnostic_recorded",
      targetType: "work_order",
      targetId: order.id,
      outcome: "ok",
      correlationId,
      ip,
    });
    return diagnosticDto(row);
  });
}

export function diagnosticRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.post("/work-orders/:workOrderId/diagnostics", { preHandler: requireAuth(deps, { permission: "diagnostic.write" }) }, async (request, reply) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      const body = diagnosticBody.parse(request.body);
      const meta = metaOf(request);
      return reply.code(201).send(await recordDiagnostic(deps, requireContext(request), workOrderId, body, meta.correlationId, meta.ip));
    });
  };
}
