import { schema, type Db } from "@reparo360/database";
import { ruleFor, type TransitionAction, type WorkOrderState } from "@reparo360/domain";
import { and, eq } from "drizzle-orm";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";
import { addEvent, type WorkOrderRow } from "./access.js";

export interface AppliedTransition {
  state: WorkOrderState;
  version: number;
}

/**
 * Aplica uma transição da tabela do domínio sobre uma OS JÁ TRAVADA (FOR UPDATE) pelo chamador.
 * `actor` nulo = sistema (expiração): não há papel a conferir e o evento fica sem autor.
 * Toda transição incrementa `version`, para que as demais operações com controle de versão enxerguem a mudança.
 */
export async function applyTransition(
  db: Db,
  input: { actor: AuthContext | null; order: WorkOrderRow; action: TransitionAction; reason?: string },
): Promise<AppliedTransition> {
  const { actor, order, action } = input;
  const rule = ruleFor(action);
  if (!rule) throw new HttpError(422, "ACAO_DESCONHECIDA", "Ação desconhecida.");

  const from = order.state as WorkOrderState;
  if (!rule.from.includes(from)) {
    throw new HttpError(422, "TRANSICAO_INVALIDA", `A ação '${action}' não é permitida no estado ${from}.`, { state: from, action });
  }
  if (actor && !rule.roles.includes(actor.role)) {
    throw new HttpError(403, "PERMISSAO_NEGADA", "Você não tem permissão para esta ação.");
  }
  const reason = input.reason?.trim();
  if (rule.reasonRequired && !reason) {
    throw new HttpError(422, "MOTIVO_OBRIGATORIO", "Informe o motivo desta ação.");
  }

  const [updated] = await db
    .update(schema.workOrders)
    .set({ state: rule.to, version: order.version + 1, updatedAt: new Date() })
    .where(and(eq(schema.workOrders.tenantId, order.tenantId), eq(schema.workOrders.id, order.id), eq(schema.workOrders.version, order.version)))
    .returning({ version: schema.workOrders.version });
  if (!updated) throw new HttpError(409, "CONFLITO_DE_VERSAO", "A OS foi alterada por outra pessoa. Recarregue e tente novamente.");

  await addEvent(db, {
    tenantId: order.tenantId,
    workOrderId: order.id,
    type: rule.event,
    fromState: from,
    toState: rule.to,
    actorUserId: actor?.userId,
    reason,
  });
  return { state: rule.to, version: updated.version };
}
