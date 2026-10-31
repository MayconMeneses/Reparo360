import { schema, withContext } from "@reparo360/database";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../../http-error.js";
import { requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";
import { pagination } from "../shared/query.js";

// Mesmo critério do dashboard: dias em São Paulo (UTC-03:00 fixo), `from` e `to` inclusivos.
const BRT = "-03:00";
const DAY_MS = 86_400_000;
const MAX_PERIOD_DAYS = 366;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD.");

const listAuditQuery = z.strictObject({
  action: z.string().regex(/^[a-z0-9_]{1,60}$/).optional(),
  outcome: z.enum(["ok", "negado"]).optional(),
  from: date.optional(),
  to: date.optional(),
  ...pagination,
});

export type AuditActorKind = "equipe" | "plataforma" | "cliente" | "sistema";

/** Quem agiu, sem expor identificadores internos: pessoa da equipe (nome), a plataforma, o consumidor pelo portal ou o sistema. */
function actorOf(action: string, actorName: string | null, hasActor: boolean): { kind: AuditActorKind; name: string | null } {
  if (action.startsWith("master_")) return { kind: "plataforma", name: null };
  if (hasActor) return { kind: "equipe", name: actorName };
  if (action.endsWith("_remoto") || action === "customer_code_requested" || action.startsWith("portal_view")) return { kind: "cliente", name: null };
  return { kind: "sistema", name: null };
}

export async function listAudit(deps: AppServices, tenantId: string, userId: string, input: z.infer<typeof listAuditQuery>) {
  const start = input.from ? new Date(`${input.from}T00:00:00${BRT}`) : undefined;
  const end = input.to ? new Date(new Date(`${input.to}T00:00:00${BRT}`).getTime() + DAY_MS) : undefined;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime())) || (start && end && end <= start)) {
    throw new HttpError(400, "PERIODO_INVALIDO", "Período inválido.");
  }
  if (start && end && (end.getTime() - start.getTime()) / DAY_MS > MAX_PERIOD_DAYS) {
    throw new HttpError(400, "PERIODO_INVALIDO", `O período máximo é de ${MAX_PERIOD_DAYS} dias.`);
  }

  return withContext(deps.pool, { tenantId, userId }, async (db) => {
    const a = schema.auditEvents;
    // Uma linha a mais que o pedido: diz se há mais páginas sem uma contagem total cara.
    const rows = await db
      .select({
        id: a.id, at: a.createdAt, action: a.action, outcome: a.outcome, actorUserId: a.actorUserId,
        targetType: a.targetType, targetId: a.targetId, reason: a.reason, actorName: schema.users.name,
      })
      .from(a)
      .leftJoin(schema.users, eq(schema.users.id, a.actorUserId))
      .where(and(
        eq(a.tenantId, tenantId),
        input.action ? eq(a.action, input.action) : undefined,
        input.outcome ? eq(a.outcome, input.outcome) : undefined,
        start ? gte(a.createdAt, start) : undefined,
        end ? lt(a.createdAt, end) : undefined,
      ))
      .orderBy(desc(a.createdAt), desc(a.id))
      .limit(input.limit + 1)
      .offset(input.offset);
    const page = rows.slice(0, input.limit);
    return {
      // Sem IP, sem ID de correlação e sem ID de ator: só o necessário para quem audita.
      events: page.map((r) => ({
        id: r.id, at: r.at, action: r.action, outcome: r.outcome, targetType: r.targetType, targetId: r.targetId, reason: r.reason,
        actor: actorOf(r.action, r.actorName, r.actorUserId !== null),
      })),
      hasMore: rows.length > input.limit,
    };
  });
}

export function auditRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/audit", { preHandler: requireAuth(deps, { permission: "audit.read" }) }, async (request, reply) => {
      const auth = requireContext(request);
      const result = await listAudit(deps, auth.tenantId, auth.userId, listAuditQuery.parse(request.query));
      return reply.header("cache-control", "no-store").send(result);
    });
  };
}
