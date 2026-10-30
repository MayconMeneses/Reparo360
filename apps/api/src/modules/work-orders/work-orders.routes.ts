import type { FastifyInstance } from "fastify";
import { metaOf, requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import { getWorkOrder, listWorkOrders } from "./queries.js";
import { assignTechnicianBody, claimBody, idempotencyHeader, listWorkOrdersQuery, openWorkOrderBody, transitionBody, workOrderParams } from "./schemas.js";
import { assignTechnician, openWorkOrder } from "./work-orders.service.js";
import { claimOrder, listQueue, transitionOrder } from "./workflow.service.js";

export function workOrderRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.post("/work-orders", { preHandler: requireAuth(deps, { permission: "work_order.create" }) }, async (request, reply) => {
      const body = openWorkOrderBody.parse(request.body);
      const key = idempotencyHeader.parse(request.headers["idempotency-key"]);
      const opened = await openWorkOrder(deps, requireContext(request), body, key, metaOf(request));
      const { replay, ...payload } = opened;
      reply.header("idempotent-replay", String(replay));
      return reply.code(replay ? 200 : 201).send(payload);
    });

    app.get("/work-orders", { preHandler: requireAuth(deps, { permission: "work_order.read" }) }, async (request) => {
      const query = listWorkOrdersQuery.parse(request.query);
      return { workOrders: await listWorkOrders(deps, requireContext(request), query) };
    });

    // Rota estática: tem precedência sobre /work-orders/:workOrderId.
    app.get("/work-orders/queue", { preHandler: requireAuth(deps, { permission: "work_order.claim" }) }, async (request) => ({
      queue: await listQueue(deps, requireContext(request)),
    }));

    app.post("/work-orders/:workOrderId/claim", { preHandler: requireAuth(deps, { permission: "work_order.claim" }) }, async (request) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      const body = claimBody.parse(request.body);
      return claimOrder(deps, requireContext(request), workOrderId, body.expectedVersion, metaOf(request));
    });

    app.post("/work-orders/:workOrderId/transitions", { preHandler: requireAuth(deps, { permission: "work_order.transition" }) }, async (request) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      const body = transitionBody.parse(request.body);
      return transitionOrder(deps, requireContext(request), workOrderId, body, metaOf(request));
    });

    app.get("/work-orders/:workOrderId", { preHandler: requireAuth(deps, { permission: "work_order.read" }) }, async (request) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      return getWorkOrder(deps, requireContext(request), workOrderId);
    });

    app.patch("/work-orders/:workOrderId/technician", { preHandler: requireAuth(deps, { permission: "work_order.assign" }) }, async (request) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      const body = assignTechnicianBody.parse(request.body);
      return assignTechnician(deps, requireContext(request), workOrderId, body, metaOf(request));
    });
  };
}
