import { schema, type Db } from "@reparo360/database";
import { isRestrictedToAssigned } from "@reparo360/domain";
import { and, eq, type SQL } from "drizzle-orm";
import type { AuthContext } from "../../auth-context.js";
import { HttpError } from "../../http-error.js";

export type WorkOrderRow = typeof schema.workOrders.$inferSelect;

/** "Outra empresa", "inexistente" e "não atribuída ao técnico" respondem exatamente igual. */
export const orderNotFound = () => new HttpError(404, "OS_NAO_ENCONTRADA", "Ordem de serviço não encontrada.");

/** Restrição de visibilidade do papel: técnico só enxerga OS atribuídas a ele. */
export function visibleToActor(auth: AuthContext): SQL | undefined {
  return isRestrictedToAssigned(auth.role) ? eq(schema.workOrders.technicianId, auth.userId) : undefined;
}

/**
 * Resolve uma OS pelo id enviado pelo cliente, sempre dentro do tenant da sessão
 * e respeitando o recorte do papel. `lock` trava a linha para alterações.
 */
export async function loadOrderForActor(db: Db, auth: AuthContext, orderId: string, lock = false): Promise<WorkOrderRow> {
  const query = db
    .select()
    .from(schema.workOrders)
    .where(and(eq(schema.workOrders.tenantId, auth.tenantId), eq(schema.workOrders.id, orderId), visibleToActor(auth)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw orderNotFound();
  return row;
}

export interface EventInput {
  tenantId: string;
  workOrderId: string;
  type: string;
  actorUserId: string;
  fromState?: string;
  toState?: string;
  reason?: string;
}

export async function addEvent(db: Db, event: EventInput): Promise<void> {
  await db.insert(schema.workOrderEvents).values(event);
}
