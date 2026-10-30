import { schema, type Db } from "@reparo360/database";
import { evaluateTestRound, type TestResult, type TransitionAction } from "@reparo360/domain";
import { and, eq, sql } from "drizzle-orm";
import { HttpError } from "../../http-error.js";
import type { WorkOrderRow } from "./access.js";

/** Resultados da última rodada registrada no CICLO DE TESTES ATUAL (rodadas de ciclos anteriores não valem). */
export async function latestTestRound(db: Db, order: WorkOrderRow): Promise<Array<typeof schema.testChecks.$inferSelect>> {
  if (order.testCycle === 0) return [];
  const [last] = await db
    .select({ round: sql<number>`coalesce(max(${schema.testChecks.round}), 0)::int` })
    .from(schema.testChecks)
    .where(and(
      eq(schema.testChecks.tenantId, order.tenantId),
      eq(schema.testChecks.workOrderId, order.id),
      eq(schema.testChecks.cycle, order.testCycle),
    ));
  if (!last || last.round === 0) return [];
  return db
    .select()
    .from(schema.testChecks)
    .where(and(
      eq(schema.testChecks.tenantId, order.tenantId),
      eq(schema.testChecks.workOrderId, order.id),
      eq(schema.testChecks.round, last.round),
    ));
}

/** Condições de cada ação que dependem de registros, avaliadas com a OS já travada. */
export async function assertPreconditions(db: Db, order: WorkOrderRow, action: TransitionAction): Promise<void> {
  switch (action) {
    case "iniciar_diagnostico":
      if (!order.technicianId) throw new HttpError(422, "SEM_TECNICO_ATRIBUIDO", "Atribua um técnico antes de iniciar o diagnóstico.");
      return;

    case "iniciar_testes": {
      // Vale só o reparo registrado NESTE ciclo de bancada (não o de uma passagem anterior).
      const [row] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.repairTasks)
        .where(and(
          eq(schema.repairTasks.tenantId, order.tenantId),
          eq(schema.repairTasks.workOrderId, order.id),
          eq(schema.repairTasks.cycle, order.repairCycle),
        ));
      if (!row || row.total === 0) {
        throw new HttpError(422, "SEM_REPARO_REGISTRADO", "Registre ao menos uma tarefa de reparo antes de iniciar os testes.");
      }
      return;
    }

    case "aprovar_testes": {
      const evaluation = evaluateTestRound((await latestTestRound(db, order)).map((r) => r.result as TestResult));
      if (!evaluation.approvable) {
        throw new HttpError(422, "TESTES_NAO_APROVAVEIS", "Os testes finais não permitem liberar o equipamento.", { reasons: evaluation.reasons });
      }
      return;
    }

    case "reprovar_testes": {
      const evaluation = evaluateTestRound((await latestTestRound(db, order)).map((r) => r.result as TestResult));
      if (!evaluation.hasFailure) {
        throw new HttpError(422, "SEM_ITEM_REPROVADO", "Para reprovar, registre ao menos um item reprovado nos testes.");
      }
      return;
    }

    default:
      return;
  }
}
