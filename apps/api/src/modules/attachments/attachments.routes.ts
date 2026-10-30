import { ATTACHMENT_TYPES } from "@reparo360/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { metaOf, requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import { workOrderParams } from "../work-orders/schemas.js";
import { deleteAttachment, downloadAttachment, MAX_ATTACHMENT_BYTES, uploadAttachment } from "./attachments.service.js";

const attachmentParams = z.strictObject({ attachmentId: z.uuid() });

export function attachmentRoutes(deps: AppServices) {
  const uploadGuard = requireAuth(deps, { permission: "attachment.upload" });

  return async function register(app: FastifyInstance): Promise<void> {
    // O parser binário e o limite maior existem só neste plugin; o resto da API segue com 100 KB.
    app.addContentTypeParser([...ATTACHMENT_TYPES], { parseAs: "buffer", bodyLimit: MAX_ATTACHMENT_BYTES }, (_request, body, done) =>
      done(null, body));

    app.post(
      "/work-orders/:workOrderId/attachments",
      // onRequest: autentica e valida CSRF ANTES de ler o corpo (não bufferiza 8 MB para anônimo).
      { onRequest: uploadGuard, bodyLimit: MAX_ATTACHMENT_BYTES },
      async (request, reply) => {
        const { workOrderId } = workOrderParams.parse(request.params);
        const declared = String(request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
        const created = await uploadAttachment(deps, requireContext(request), workOrderId, declared, request.body as Buffer, metaOf(request));
        return reply.code(201).send(created);
      },
    );

    app.get("/attachments/:attachmentId", { preHandler: requireAuth(deps, { permission: "attachment.read" }) }, async (request, reply) => {
      const { attachmentId } = attachmentParams.parse(request.params);
      const file = await downloadAttachment(deps, requireContext(request), attachmentId, metaOf(request));
      return reply
        .header("content-type", file.contentType)
        .header("content-disposition", "attachment")
        .header("x-content-type-options", "nosniff")
        .send(file.data);
    });

    app.delete("/attachments/:attachmentId", { preHandler: requireAuth(deps, { permission: "attachment.delete" }) }, async (request, reply) => {
      const { attachmentId } = attachmentParams.parse(request.params);
      await deleteAttachment(deps, requireContext(request), attachmentId, metaOf(request));
      return reply.code(204).send();
    });
  };
}
