import { schema, type Db } from "@reparo360/database";

export interface AuditEntry {
  tenantId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome: "ok" | "negado";
  correlationId?: string;
  ip?: string;
}

/** Deve ser chamada dentro da transação da operação auditada. Nunca grava dados pessoais. */
export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditEvents).values(entry);
}
