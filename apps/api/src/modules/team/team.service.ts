import { randomUUID } from "node:crypto";
import { schema, withContext } from "@reparo360/database";
import { canManageMember, type TenantRole } from "@reparo360/domain";
import { and, eq } from "drizzle-orm";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError, isUniqueViolation } from "../../http-error.js";
import { hashPassword } from "../../security/password.js";
import type { AuthServiceDeps, RequestMeta } from "../identity/auth.service.js";

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: TenantRole;
  status: string;
}

const forbidden = () => new HttpError(403, "PERMISSAO_NEGADA", "Você não tem permissão para esta ação.");
const memberNotFound = () => new HttpError(404, "MEMBRO_NAO_ENCONTRADO", "Membro não encontrado.");

export async function listMembers(deps: AuthServiceDeps, auth: AuthContext): Promise<TeamMember[]> {
  const rows = await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, (db) =>
    db
      .select({
        userId: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.memberships.role,
        status: schema.memberships.status,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.tenantId, auth.tenantId))
      .orderBy(schema.users.name));
  return rows.map((row) => ({ ...row, role: row.role as TenantRole }));
}

export interface CreateMemberInput {
  name: string;
  email: string;
  password: string;
  role: TenantRole;
}

/**
 * Cria a conta do novo membro com senha inicial definida por quem cadastra.
 * Provisório: o convite por e-mail depende da decisão P-03 (canal de envio).
 */
export async function createMember(deps: AuthServiceDeps, auth: AuthContext, input: CreateMemberInput, meta: RequestMeta) {
  if (!canManageMember(auth.role, input.role, input.role)) throw forbidden();
  const userId = randomUUID();
  const passwordHash = await hashPassword(input.password);
  try {
    await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
      await db.insert(schema.users).values({ id: userId, email: input.email, name: input.name, passwordHash });
      await db.insert(schema.memberships).values({ tenantId: auth.tenantId, userId, role: input.role });
      await recordAudit(db, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: "team_member_created",
        targetType: "user",
        targetId: userId,
        outcome: "ok",
        correlationId: meta.correlationId,
        ip: meta.ip,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "EMAIL_JA_CADASTRADO", "Este e-mail já está cadastrado.");
    throw error;
  }
  return { userId };
}

export interface UpdateMemberInput {
  role?: TenantRole;
  status?: "ativo" | "desativado";
}

export async function updateMember(
  deps: AuthServiceDeps,
  auth: AuthContext,
  targetUserId: string,
  input: UpdateMemberInput,
  meta: RequestMeta,
): Promise<void> {
  if (targetUserId === auth.userId) {
    throw new HttpError(422, "NAO_PODE_ALTERAR_A_SI_MESMO", "Você não pode alterar o próprio vínculo.");
  }
  await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
    // Linha bloqueada para que duas alterações simultâneas não furem a regra do último proprietário.
    const [target] = await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.tenantId, auth.tenantId), eq(schema.memberships.userId, targetUserId)))
      .for("update")
      .limit(1);
    if (!target) throw memberNotFound();

    const targetRole = target.role as TenantRole;
    if (!canManageMember(auth.role, targetRole, input.role)) throw forbidden();

    const newRole = input.role ?? targetRole;
    const newStatus = input.status ?? target.status;
    const stillActiveOwner = newRole === "proprietario" && newStatus === "ativo";
    if (targetRole === "proprietario" && target.status === "ativo" && !stillActiveOwner) {
      // Trava todas as linhas de proprietário (em ordem fixa, sem deadlock) antes de contar:
      // senão dois proprietários rebaixando um ao outro veriam "2 ativos" e ambos passariam.
      const owners = await db
        .select({ id: schema.memberships.id, status: schema.memberships.status })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.tenantId, auth.tenantId), eq(schema.memberships.role, "proprietario")))
        .orderBy(schema.memberships.id)
        .for("update");
      if (owners.filter((owner) => owner.status === "ativo").length <= 1) {
        throw new HttpError(422, "ULTIMO_PROPRIETARIO", "A assistência precisa de ao menos um proprietário ativo.");
      }
    }

    await db
      .update(schema.memberships)
      .set({ role: newRole, status: newStatus, updatedAt: new Date() })
      .where(eq(schema.memberships.id, target.id));
    // Mudança de papel ou desativação encerra as sessões do alvo nesta empresa.
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.sessions.userId, targetUserId), eq(schema.sessions.tenantId, auth.tenantId)));
    await recordAudit(db, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "team_member_updated",
      targetType: "user",
      targetId: targetUserId,
      outcome: "ok",
      correlationId: meta.correlationId,
      ip: meta.ip,
    });
  });
}
