import { randomBytes, randomUUID } from "node:crypto";
import { schema, withContext } from "@reparo360/database";
import { canManageMember, type TenantRole } from "@reparo360/domain";
import { and, eq, sql } from "drizzle-orm";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import { HttpError, isUniqueViolation } from "../../http-error.js";
import { hashPassword } from "../../security/password.js";
import { hashToken, newToken } from "../../security/tokens.js";
import type { AppServices } from "../../services.js";
import type { AuthServiceDeps, RequestMeta } from "../identity/auth.service.js";
import { INVITE_TTL_MS, passwordLink, sendLater, type MailLog } from "../identity/password-reset.js";

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
  /** Senha inicial definida por quem cadastra. Ausente quando `inviteByEmail` é verdadeiro. */
  password?: string;
  /** Convite por e-mail: a pessoa define a própria senha; quem convida nunca vê nem escolhe senha. */
  inviteByEmail?: true;
  role: TenantRole;
}

/**
 * Cria a conta do novo membro: com senha inicial definida por quem cadastra, OU por convite por e-mail
 * (conta nasce travada com senha aleatória que ninguém conhece; o link do e-mail é o único caminho).
 * Se o e-mail já existe no sistema, a resposta é a mesma de sempre (409): ninguém recebe link por iniciativa de outra assistência.
 */
export async function createMember(deps: AppServices, auth: AuthContext, input: CreateMemberInput, meta: RequestMeta, log: MailLog) {
  if (!canManageMember(auth.role, input.role, input.role)) throw forbidden();
  const invite = input.inviteByEmail === true;
  if (invite && (!deps.mailer.enabled || !deps.config.publicUrl)) {
    throw new HttpError(422, "ENVIO_INDISPONIVEL", "O convite por e-mail não está disponível: o envio de e-mail não está configurado. Cadastre com senha inicial.");
  }
  if (invite) {
    // Limite de volume por assistência: conta todo convite (conta nova ou já existente) e responde igual ao passar do limite.
    const key = `invite|${auth.tenantId}`;
    if (deps.inviteThrottle.isBlocked(key)) throw new HttpError(429, "MUITOS_CONVITES", "Muitos convites em pouco tempo. Tente de novo mais tarde.");
    deps.inviteThrottle.fail(key);
  }
  const userId = randomUUID();
  const passwordHash = await hashPassword(invite ? randomBytes(32).toString("base64url") : (input.password ?? ""));
  const token = invite ? newToken() : null;
  let tenantName = "";
  try {
    await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
      await db.insert(schema.users).values({ id: userId, email: input.email, name: input.name, passwordHash, mustChangePassword: invite });
      await db.insert(schema.memberships).values({ tenantId: auth.tenantId, userId, role: input.role });
      if (token) {
        const now = deps.clock();
        const [tenant] = await db.select({ name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, auth.tenantId)).limit(1);
        tenantName = tenant?.name ?? "";
        const issued = await db.execute<{ pw_token_invite: boolean }>(
          sql`SELECT pw_token_invite(${userId}::uuid, ${hashToken(token)}, ${new Date(now.getTime() + INVITE_TTL_MS).toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`);
        if (!issued.rows[0]?.pw_token_invite) throw new Error("convite não emitido");
      }
      await recordAudit(db, {
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: invite ? "team_member_invited" : "team_member_created",
        targetType: "user",
        // No convite o alvo fica fora do registro: o registro é igual quando o e-mail já tinha conta (a lista de membros mostra quem entrou).
        targetId: invite ? undefined : userId,
        outcome: "ok",
        correlationId: meta.correlationId,
        ip: meta.ip,
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Cadastro com senha inicial: quem cadastra escolheu a senha e vê o resultado, então o 409 continua.
    if (!invite) throw new HttpError(409, "EMAIL_JA_CADASTRADO", "Este e-mail já está cadastrado.");
    // Convite: a resposta é a MESMA exista ou não conta com esse e-mail (senão uma assistência descobriria quem tem conta em outra).
    // Quem já tem conta recebe um aviso, sem link e sem entrar na equipe; a auditoria também é igual nos dois casos.
    const name = await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
      const [tenant] = await db.select({ name: schema.tenants.name }).from(schema.tenants).where(eq(schema.tenants.id, auth.tenantId)).limit(1);
      await recordAudit(db, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: "team_member_invited", targetType: "user",
        outcome: "ok", correlationId: meta.correlationId, ip: meta.ip,
      });
      return tenant?.name ?? "";
    });
    sendLater(deps, log, {
      to: input.email,
      subject: "Convite para uma equipe — Reparo360",
      text: `Olá.\n\nA assistência ${name || "uma assistência"} tentou convidar este e-mail para a equipe no Reparo360, mas ele já tem uma conta. Nenhuma alteração foi feita na sua conta. Se quiser participar dessa equipe, combine com a assistência por outro meio.\n\nSe não esperava este aviso, ignore a mensagem.`,
    });
    return { userId: null };
  }
  // O token só existe aqui e no e-mail: nunca volta na resposta da API.
  if (token) {
    sendLater(deps, log, {
      to: input.email,
      subject: `Convite para ${tenantName || "a assistência"} — Reparo360`,
      text: `Olá, ${input.name}.\n\nVocê foi convidado(a) para a equipe de ${tenantName || "uma assistência"} como ${input.role}. Para definir a sua senha e entrar, abra o link (vale por ${INVITE_TTL_MS / 3_600_000} horas e só pode ser usado uma vez):\n\n${passwordLink(deps, token)}\n\nSe não esperava este convite, ignore a mensagem.`,
    });
  }
  return { userId: invite ? null : userId };
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
