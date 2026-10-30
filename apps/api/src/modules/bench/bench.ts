import { schema, withContext } from "@reparo360/database";
import { evaluateTestRound, REPAIR_OUTCOMES, TEST_RESULTS, type TestResult } from "@reparo360/domain";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import { metaOf, requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import type { RequestMeta } from "../identity/auth.service.js";
import { addEvent, loadOrderForActor } from "../work-orders/access.js";
import { workOrderParams } from "../work-orders/schemas.js";

const text = (max: number) => z.string().trim().min(1).max(max);

export const repairBody = z.strictObject({
  procedure: z.string().trim().min(3).max(2000),
  partsUsed: text(500).optional(),
  outcome: z.enum(REPAIR_OUTCOMES),
  notes: text(1000).optional(),
});

export const testsBody = z.strictObject({
  items: z
    .array(z.strictObject({ item: text(80), result: z.enum(TEST_RESULTS), note: text(300).optional() }))
    .min(1)
    .max(40)
    .refine((items) => new Set(items.map((i) => i.item.toLowerCase())).size === items.length, { message: "Itens de teste repetidos." }),
});

const ctxOf = (auth: AuthContext) => ({ tenantId: auth.tenantId, userId: auth.userId });

export async function recordRepair(deps: AppServices, auth: AuthContext, orderId: string, input: z.infer<typeof repairBody>, meta: RequestMeta) {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const order = await loadOrderForActor(db, auth, orderId, true);
    if (order.state !== "EM_REPARO") throw new HttpError(422, "OS_FORA_DE_REPARO", "O reparo só é registrado com a OS em reparo.");
    const [row] = await db
      .insert(schema.repairTasks)
      .values({ ...input, tenantId: auth.tenantId, workOrderId: order.id, cycle: order.repairCycle, authorId: auth.userId })
      .returning({ id: schema.repairTasks.id, cycle: schema.repairTasks.cycle });
    if (!row) throw new Error("insert de reparo não retornou linha");
    await addEvent(db, { tenantId: auth.tenantId, workOrderId: order.id, type: "reparo_registrado", actorUserId: auth.userId });
    await recordAudit(db, {
      tenantId: auth.tenantId, actorUserId: auth.userId, action: "repair_recorded", targetType: "work_order", targetId: order.id,
      outcome: "ok", correlationId: meta.correlationId, ip: meta.ip,
    });
    return row;
  });
}

/** Cada envio é uma rodada nova (append-only); vale a última rodada do ciclo de testes atual. */
export async function recordTests(deps: AppServices, auth: AuthContext, orderId: string, input: z.infer<typeof testsBody>, meta: RequestMeta) {
  return withContext(deps.pool, ctxOf(auth), async (db) => {
    const order = await loadOrderForActor(db, auth, orderId, true);
    if (order.state !== "EM_TESTE") throw new HttpError(422, "OS_FORA_DE_TESTE", "Os testes só são registrados com a OS em teste.");
    const [last] = await db
      .select({ round: sql<number>`coalesce(max(${schema.testChecks.round}), 0)::int` })
      .from(schema.testChecks)
      .where(and(eq(schema.testChecks.tenantId, auth.tenantId), eq(schema.testChecks.workOrderId, order.id)));
    const round = (last?.round ?? 0) + 1;
    await db.insert(schema.testChecks).values(
      input.items.map((entry) => ({
        ...entry, tenantId: auth.tenantId, workOrderId: order.id, cycle: order.testCycle, round, recordedBy: auth.userId,
      })),
    );
    await addEvent(db, { tenantId: auth.tenantId, workOrderId: order.id, type: "testes_registrados", actorUserId: auth.userId });
    await recordAudit(db, {
      tenantId: auth.tenantId, actorUserId: auth.userId, action: "tests_recorded", targetType: "work_order", targetId: order.id,
      outcome: "ok", correlationId: meta.correlationId, ip: meta.ip,
    });
    const evaluation = evaluateTestRound(input.items.map((i) => i.result as TestResult));
    return { round, cycle: order.testCycle, ...evaluation };
  });
}

export function benchRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.post("/work-orders/:workOrderId/repairs", { preHandler: requireAuth(deps, { permission: "repair.update" }) }, async (request, reply) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      const body = repairBody.parse(request.body);
      return reply.code(201).send(await recordRepair(deps, requireContext(request), workOrderId, body, metaOf(request)));
    });

    app.post("/work-orders/:workOrderId/test-checks", { preHandler: requireAuth(deps, { permission: "test_checklist.write" }) }, async (request, reply) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      const body = testsBody.parse(request.body);
      return reply.code(201).send(await recordTests(deps, requireContext(request), workOrderId, body, metaOf(request)));
    });
  };
}
