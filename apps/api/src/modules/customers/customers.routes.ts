import type { FastifyInstance } from "fastify";
import { requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "./customers.service.js";
import { createCustomerBody, customerParams, listCustomersQuery, updateCustomerBody } from "./schemas.js";

export function customerRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.post("/customers", { preHandler: requireAuth(deps, { permission: "customer.create" }) }, async (request, reply) => {
      const body = createCustomerBody.parse(request.body);
      return reply.code(201).send(await createCustomer(deps, requireContext(request), body));
    });

    app.get("/customers", { preHandler: requireAuth(deps, { permission: "customer.read" }) }, async (request) => {
      const query = listCustomersQuery.parse(request.query);
      return { customers: await listCustomers(deps, requireContext(request), query) };
    });

    app.get("/customers/:customerId", { preHandler: requireAuth(deps, { permission: "customer.read" }) }, async (request) => {
      const { customerId } = customerParams.parse(request.params);
      return getCustomer(deps, requireContext(request), customerId);
    });

    app.patch("/customers/:customerId", { preHandler: requireAuth(deps, { permission: "customer.update" }) }, async (request) => {
      const { customerId } = customerParams.parse(request.params);
      const body = updateCustomerBody.parse(request.body);
      return updateCustomer(deps, requireContext(request), customerId, body);
    });
  };
}
