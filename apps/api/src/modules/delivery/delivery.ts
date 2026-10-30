import { schema, withContext } from "@reparo360/database";
import { accessoriesDiffer, DELIVERY_CONFIRMATIONS } from "@reparo360/domain";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import { metaOf, requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import type { RequestMeta } from "../identity/auth.service.js";
import { loadOrderForActor } from "../work-orders/access.js";
import { workOrderParams } from "../work-orders/schemas.js";
import { applyTransition, assertTransitionAllowed } from "../work-orders/transitions.js";

export const deliveryBody = z.strictObject({
  expectedVersion: z.number().int().min(1),
  pickedUpByName: z.string().trim().min(2).max(120),
  confirmationMethod: z.enum(DELIVERY_CONFIRMATIONS),
  itemsReturned: z.array(z.string().trim().min(1).max(60)).max(20),
  /** Obrigatória quando os acessórios devolvidos diferem dos recebidos. */
  note: z.string().trim().min(3).max(500).optional(),
});

/**
 * Registro de entrega e transição `entregar` na MESMA transação: não existe OS entregue sem registro,
 * nem registro sem OS entregue. A ação não é exposta no endpoint genérico de transições.
 */
export async function deliverOrder(deps: AppServices, auth: AuthContext, orderId: string, input: z.infer<typeof deliveryBody>, meta: RequestMeta) {
  return withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
    const order = await loadOrderForActor(db, auth, orderId, true);
    if (order.version !== input.expectedVersion) {
      throw new HttpError(409, "CONFLITO_DE_VERSAO", "A OS foi alterada por outra pessoa. Recarregue e tente novamente.", { currentVersion: order.version });
    }
    // Estado e papel primeiro: a mensagem de acessórios só importa se a OS puder mesmo ser entregue.
    assertTransitionAllowed(order, "entregar", auth);
    const [inspection] = await db
      .select({ accessories: schema.intakeInspections.accessories })
      .from(schema.intakeInspections)
      .where(and(eq(schema.intakeInspections.tenantId, auth.tenantId), eq(schema.intakeInspections.workOrderId, order.id)))
      .limit(1);
    if (accessoriesDiffer(inspection?.accessories ?? [], input.itemsReturned) && !input.note) {
      throw new HttpError(422, "OBSERVACAO_OBRIGATORIA", "Os acessórios devolvidos diferem dos recebidos. Explique na observação.", {
        received: inspection?.accessories ?? [],
      });
    }

    const applied = await applyTransition(db, { actor: auth, order, action: "entregar", reason: input.note });
    const [delivery] = await db
      .insert(schema.deliveries)
      .values({
        tenantId: auth.tenantId,
        workOrderId: order.id,
        deliveredBy: auth.userId,
        pickedUpByName: input.pickedUpByName,
        confirmationMethod: input.confirmationMethod,
        itemsReturned: input.itemsReturned,
        note: input.note,
      })
      .returning({ id: schema.deliveries.id });
    if (!delivery) throw new Error("insert de entrega não retornou linha");
    await recordAudit(db, {
      tenantId: auth.tenantId, actorUserId: auth.userId, action: "delivery_registered", targetType: "work_order", targetId: order.id,
      outcome: "ok", correlationId: meta.correlationId, ip: meta.ip,
    });
    return { deliveryId: delivery.id, state: applied.state, version: applied.version };
  });
}

export function deliveryRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.post("/work-orders/:workOrderId/delivery", { preHandler: requireAuth(deps, { permission: "delivery.register" }) }, async (request, reply) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      const body = deliveryBody.parse(request.body);
      return reply.code(201).send(await deliverOrder(deps, requireContext(request), workOrderId, body, metaOf(request)));
    });
  };
}
