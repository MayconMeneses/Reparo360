import { schema, withContext, type Db } from "@reparo360/database";
import { and, eq, gt, isNull } from "drizzle-orm";
import { HttpError } from "../../http-error.js";
import { hashToken } from "../../security/tokens.js";
import type { AppServices } from "../../services.js";

export type GrantRow = typeof schema.customerAccessGrants.$inferSelect;

/** Resposta única para qualquer falha de acesso: token errado, expirado, revogado, de outra OS ou OS encerrada. */
export const invalidLink = () => new HttpError(404, "LINK_INVALIDO", "Link inválido ou expirado.");

/** Resolve o link pelo hash do token, sem sessão. Qualquer falha é o mesmo 404. */
export async function resolveGrant(deps: AppServices, token: string | undefined): Promise<GrantRow> {
  if (!token || token.length < 20 || token.length > 100) throw invalidLink();
  const now = deps.clock();
  const grant = await withContext(deps.pool, { grantHash: hashToken(token) }, async (db) => {
    const [row] = await db
      .select()
      .from(schema.customerAccessGrants)
      .where(and(isNull(schema.customerAccessGrants.revokedAt), gt(schema.customerAccessGrants.expiresAt, now)))
      .limit(1);
    return row;
  });
  if (!grant) throw invalidLink();
  return grant;
}

/** Reconfere o link dentro da transação que age: ele pode ter sido revogado depois da primeira leitura. */
export async function isGrantLive(db: Db, deps: AppServices, grant: GrantRow): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.customerAccessGrants.id })
    .from(schema.customerAccessGrants)
    .where(and(
      eq(schema.customerAccessGrants.tenantId, grant.tenantId),
      eq(schema.customerAccessGrants.id, grant.id),
      isNull(schema.customerAccessGrants.revokedAt),
      gt(schema.customerAccessGrants.expiresAt, deps.clock()),
    ))
    .limit(1);
  return Boolean(row);
}
