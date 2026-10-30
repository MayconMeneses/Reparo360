import type { FastifyInstance } from "fastify";
import { HttpError } from "../../http-error.js";
import { metaOf, requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import { workOrderParams } from "../work-orders/schemas.js";
import { createDraft, listOrderQuotes, updateDraft } from "./quotes.drafts.js";
import { decideQuote, expireDueQuotes, reviseQuote, submitQuote } from "./quotes.workflow.js";
import { createQuoteBody, decisionBody, quoteParams, submitQuoteBody, updateQuoteBody } from "./schemas.js";

export function quoteRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.post("/work-orders/:workOrderId/quotes", { preHandler: requireAuth(deps, { permission: "quote.create" }) }, async (request, reply) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      const body = createQuoteBody.parse(request.body);
      return reply.code(201).send(await createDraft(deps, requireContext(request), workOrderId, body));
    });

    app.get("/work-orders/:workOrderId/quotes", { preHandler: requireAuth(deps, { permission: "quote.read" }) }, async (request) => {
      const { workOrderId } = workOrderParams.parse(request.params);
      return { quotes: await listOrderQuotes(deps, requireContext(request), workOrderId) };
    });

    app.put("/quotes/:quoteId", { preHandler: requireAuth(deps, { permission: "quote.create" }) }, async (request) => {
      const { quoteId } = quoteParams.parse(request.params);
      const body = updateQuoteBody.parse(request.body);
      return updateDraft(deps, requireContext(request), quoteId, body);
    });

    app.post("/quotes/:quoteId/submit", { preHandler: requireAuth(deps, { permission: "quote.submit" }) }, async (request) => {
      const { quoteId } = quoteParams.parse(request.params);
      const body = submitQuoteBody.parse(request.body);
      return submitQuote(deps, requireContext(request), quoteId, body, metaOf(request));
    });

    app.post("/quotes/:quoteId/revise", { preHandler: requireAuth(deps, { permission: "quote.manage" }) }, async (request, reply) => {
      const { quoteId } = quoteParams.parse(request.params);
      return reply.code(201).send(await reviseQuote(deps, requireContext(request), quoteId, metaOf(request)));
    });

    app.post("/quotes/:quoteId/decision", { preHandler: requireAuth(deps, { permission: "quote.decision.in_person" }) }, async (request, reply) => {
      const { quoteId } = quoteParams.parse(request.params);
      const body = decisionBody.parse(request.body);
      const result = await decideQuote(deps, requireContext(request), quoteId, body, metaOf(request));
      // A expiração já foi confirmada no banco; o erro sai aqui, fora da transação.
      if (result.kind === "expired") {
        throw new HttpError(422, "ORCAMENTO_EXPIRADO", "A validade deste orçamento venceu. Ele foi marcado como expirado.");
      }
      const { kind, ...payload } = result;
      return reply.code(kind === "replay" ? 200 : 201).header("idempotent-replay", String(kind === "replay")).send(payload);
    });

    // Rota estática: varre a empresa e expira orçamentos vencidos (sem agendador, ver relatório).
    app.post("/quotes/expire-due", { preHandler: requireAuth(deps, { permission: "quote.manage" }) }, async (request) =>
      expireDueQuotes(deps, requireContext(request)));
  };
}
