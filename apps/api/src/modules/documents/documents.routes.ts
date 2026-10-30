import type { FastifyInstance } from "fastify";
import { metaOf, requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import { workOrderParams } from "../work-orders/schemas.js";
import { generateReceipt } from "./receipt.service.js";

export function documentRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get(
      "/work-orders/:workOrderId/documents/receipt",
      { preHandler: requireAuth(deps, { permission: "document.generate" }) },
      async (request, reply) => {
        const { workOrderId } = workOrderParams.parse(request.params);
        const { pdf, protocol } = await generateReceipt(deps, requireContext(request), workOrderId, metaOf(request));
        return reply
          .header("content-type", "application/pdf")
          .header("content-disposition", `attachment; filename="comprovante-${protocol}.pdf"`)
          .send(pdf);
      },
    );
  };
}
