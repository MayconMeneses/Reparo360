import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { metaOf, requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import { workOrderParams } from "../work-orders/schemas.js";
import { generateApprovalRecord, generateDeliveryReceipt, generateQuoteDocument, generateSheet, type GeneratedPdf } from "./forms.service.js";
import { generateReceipt } from "./receipt.service.js";

const quoteParams = z.strictObject({ quoteId: z.uuid() });

function sendPdf(reply: FastifyReply, file: GeneratedPdf) {
  return reply
    .header("content-type", "application/pdf")
    .header("content-disposition", `attachment; filename="${file.filename}"`)
    .send(file.pdf);
}

export function documentRoutes(deps: AppServices) {
  const guard = requireAuth(deps, { permission: "document.generate" });

  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/work-orders/:workOrderId/documents/receipt", { preHandler: guard }, async (request, reply) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      const { pdf, protocol } = await generateReceipt(deps, requireContext(request), workOrderId, metaOf(request));
      return sendPdf(reply, { pdf, filename: `comprovante-${protocol}.pdf` });
    });

    app.get("/work-orders/:workOrderId/documents/sheet", { preHandler: guard }, async (request, reply) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      return sendPdf(reply, await generateSheet(deps, requireContext(request), workOrderId, metaOf(request)));
    });

    app.get("/work-orders/:workOrderId/documents/delivery", { preHandler: guard }, async (request, reply) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      return sendPdf(reply, await generateDeliveryReceipt(deps, requireContext(request), workOrderId, metaOf(request)));
    });

    app.get("/quotes/:quoteId/document", { preHandler: guard }, async (request, reply) => {
      const { quoteId } = quoteParams.parse(request.params);
      return sendPdf(reply, await generateQuoteDocument(deps, requireContext(request), quoteId, metaOf(request)));
    });

    app.get("/quotes/:quoteId/approval-record", { preHandler: guard }, async (request, reply) => {
      const { quoteId } = quoteParams.parse(request.params);
      return sendPdf(reply, await generateApprovalRecord(deps, requireContext(request), quoteId, metaOf(request)));
    });
  };
}
