import { schema, withContext } from "@reparo360/database";
import { computeStageDurations, OPEN_STATES, type StateEvent, type WorkOrderState } from "@reparo360/domain";
import { and, asc, count, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../../http-error.js";
import { requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth } from "../../session-guard.js";

// O Brasil não tem horário de verão desde 2019; America/Sao_Paulo é UTC-03:00 fixo. Se voltar, trocar por Temporal/Intl.
const BRT = "-03:00";
const DAY_MS = 86_400_000;
const MAX_PERIOD_DAYS = 366;
const MAX_STATE_EVENTS = 200_000;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use AAAA-MM-DD.");
const query = z.strictObject({ from: date.optional(), to: date.optional() });

const startOfDay = (iso: string) => new Date(`${iso}T00:00:00${BRT}`);
const todayInSaoPaulo = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);

/** Período em dias de São Paulo: `from` e `to` inclusivos; o intervalo real é [from 00:00, to+1 00:00). */
function resolvePeriod(now: Date, input: z.infer<typeof query>) {
  const to = input.to ?? todayInSaoPaulo(now);
  const from = input.from ?? todayInSaoPaulo(new Date(startOfDay(to).getTime() - 29 * DAY_MS));
  const start = startOfDay(from);
  const end = new Date(startOfDay(to).getTime() + DAY_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new HttpError(400, "PERIODO_INVALIDO", "Período inválido.");
  if ((end.getTime() - start.getTime()) / DAY_MS > MAX_PERIOD_DAYS) throw new HttpError(400, "PERIODO_INVALIDO", `O período máximo é de ${MAX_PERIOD_DAYS} dias.`);
  return { from, to, start, end };
}

interface Indicator {
  id: string;
  label: string;
  unit: string;
  source: string;
  formula: string;
  includes: string;
  excludes: string;
  /** Indicadores de situação atual não dependem do período. */
  scope: "atual" | "periodo";
  values: unknown;
}

export async function buildDashboard(deps: AppServices, auth: { tenantId: string; userId: string }, input: z.infer<typeof query>) {
  const period = resolvePeriod(deps.clock(), input);
  const { start, end } = period;

  return withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
    const wo = schema.workOrders;
    const tenant = eq(wo.tenantId, auth.tenantId);

    const byStateRows = await db.select({ state: wo.state, total: count() }).from(wo).where(tenant).groupBy(wo.state);
    const current = new Map(byStateRows.map((r) => [r.state, r.total]));
    const openTotal = OPEN_STATES.reduce((sum, s) => sum + (current.get(s) ?? 0), 0);

    const [received] = await db.select({ total: count() }).from(wo).where(and(tenant, gte(wo.createdAt, start), lt(wo.createdAt, end)));

    const [delivered] = await db
      .select({ total: sql<number>`count(distinct ${schema.workOrderEvents.workOrderId})::int` })
      .from(schema.workOrderEvents)
      .where(and(eq(schema.workOrderEvents.tenantId, auth.tenantId), eq(schema.workOrderEvents.type, "entregue"), gte(schema.workOrderEvents.createdAt, start), lt(schema.workOrderEvents.createdAt, end)));

    const decisions = await db
      .select({ decision: schema.quoteDecisions.decision, total: count() })
      .from(schema.quoteDecisions)
      .where(and(eq(schema.quoteDecisions.tenantId, auth.tenantId), gte(schema.quoteDecisions.decidedAt, start), lt(schema.quoteDecisions.decidedAt, end)))
      .groupBy(schema.quoteDecisions.decision);

    const categories = await db
      .select({ category: schema.devices.category, total: count() })
      .from(wo)
      .innerJoin(schema.devices, and(eq(schema.devices.tenantId, wo.tenantId), eq(schema.devices.id, wo.deviceId)))
      .where(and(tenant, ne(wo.state, "CANCELADA"), gte(wo.createdAt, start), lt(wo.createdAt, end)))
      .groupBy(schema.devices.category);

    // Só interessam as OS com alguma mudança de etapa DENTRO do período: uma passagem só conta quando termina
    // no período, e isso exige um evento de saída nele. As demais OS não geram amostra, então ficam de fora
    // (resultado idêntico ao de ler todo o histórico, com muito menos linhas). Das OS escolhidas vem o histórico inteiro.
    const e = schema.workOrderEvents;
    const touchedInPeriod = db
      .selectDistinct({ id: e.workOrderId })
      .from(e)
      .where(and(eq(e.tenantId, auth.tenantId), sql`${e.toState} is not null`, gte(e.createdAt, start), lt(e.createdAt, end)));
    const stateEvents = await db
      .select({ workOrderId: schema.workOrderEvents.workOrderId, fromState: schema.workOrderEvents.fromState, toState: schema.workOrderEvents.toState, at: schema.workOrderEvents.createdAt })
      .from(schema.workOrderEvents)
      .where(and(eq(e.tenantId, auth.tenantId), sql`${e.toState} is not null`, inArray(e.workOrderId, touchedInPeriod)))
      .orderBy(asc(schema.workOrderEvents.workOrderId), asc(schema.workOrderEvents.createdAt), asc(schema.workOrderEvents.id))
      .limit(MAX_STATE_EVENTS + 1);
    if (stateEvents.length > MAX_STATE_EVENTS) throw new HttpError(422, "HISTORICO_GRANDE_DEMAIS", "Histórico grande demais para este cálculo. Reduza o período.");
    const durations = computeStageDurations(stateEvents as StateEvent[], start, end);

    const stage = (state: WorkOrderState) => current.get(state) ?? 0;
    const indicators: Indicator[] = [
      {
        id: "os_abertas", label: "OS abertas", unit: "OS", scope: "atual", source: "work_orders.state (situação atual)",
        formula: "contagem de OS cujo estado atual não é ENTREGUE, ENCERRADA nem CANCELADA",
        includes: "RECEBIDA até PRONTA_RETIRADA_SEM_REPARO", excludes: "ENTREGUE, ENCERRADA, CANCELADA", values: openTotal,
      },
      {
        id: "por_estado", label: "OS por estado atual", unit: "OS", scope: "atual", source: "work_orders.state (situação atual)",
        formula: "contagem de OS agrupadas pelo estado atual", includes: "todos os estados operacionais", excludes: "ENCERRADA e CANCELADA",
        values: Object.fromEntries((["RECEBIDA", "EM_DIAGNOSTICO", "AGUARDANDO_APROVACAO", "AGUARDANDO_PECA", "EM_REPARO", "EM_TESTE", "PRONTA_RETIRADA", "PRONTA_RETIRADA_SEM_REPARO"] as const).map((s) => [s, stage(s)])),
      },
      {
        id: "recebidas_periodo", label: "OS recebidas no período", unit: "OS", scope: "periodo", source: "work_orders.created_at",
        formula: "contagem de OS com created_at em [início, fim)", includes: "todas as OS abertas no período", excludes: "nenhuma", values: received?.total ?? 0,
      },
      {
        id: "entregues_periodo", label: "OS entregues no período", unit: "OS", scope: "periodo", source: "work_order_events (tipo 'entregue')",
        formula: "contagem de OS distintas com evento 'entregue' em [início, fim)", includes: "entregas registradas", excludes: "OS apenas encerradas sem entrega registrada",
        values: delivered?.total ?? 0,
      },
      {
        id: "orcamentos_decididos", label: "Orçamentos aprovados e recusados no período", unit: "orçamentos", scope: "periodo", source: "quote_decisions.decided_at",
        formula: "contagem de decisões (uma por versão do orçamento) com decided_at em [início, fim), por tipo de decisão",
        includes: "decisões presenciais registradas", excludes: "versões substituídas ou expiradas (não têm decisão). É contagem, nunca valor ou faturamento",
        values: { aprovado: decisions.find((d) => d.decision === "aprovado")?.total ?? 0, recusado: decisions.find((d) => d.decision === "recusado")?.total ?? 0 },
      },
      {
        id: "tempo_por_etapa", label: "Tempo por etapa", unit: "segundos (mediana)", scope: "periodo", source: "work_order_events (from_state, to_state, created_at)",
        formula: "para cada passagem por uma etapa: horário de saída - horário de entrada; mediana por etapa",
        includes: "passagens que terminaram em [início, fim); cada passagem conta uma amostra (OS que volta à etapa gera outra amostra)",
        excludes: "a etapa em que a OS está agora (ainda não terminou)", values: durations,
      },
      {
        id: "servicos_por_categoria", label: "Serviços por categoria de equipamento", unit: "OS", scope: "periodo", source: "work_orders.created_at + devices.category",
        formula: "contagem de OS abertas em [início, fim) agrupadas pela categoria do equipamento", includes: "todas as categorias", excludes: "OS canceladas",
        values: Object.fromEntries(categories.map((c) => [c.category, c.total])),
      },
    ];

    return {
      period: { from: period.from, to: period.to, timezone: "America/Sao_Paulo", startUtc: start.toISOString(), endExclusiveUtc: end.toISOString() },
      generatedAt: deps.clock().toISOString(),
      indicators,
    };
  });
}

export function dashboardRoutes(deps: AppServices) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get("/dashboard", { preHandler: requireAuth(deps, { permission: "report.operational.read" }) }, async (request) => {
      const auth = requireContext(request);
      return buildDashboard(deps, auth, query.parse(request.query));
    });
  };
}
