import { randomUUID } from "node:crypto";
import { schema, withContext } from "@reparo360/database";
import { tenantCanOperate, type TenantRole, type TenantStatus } from "@reparo360/domain";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { recordAudit } from "../../audit.js";
import type { AuthContext } from "../../auth-context.js";
import type { Config } from "../../config.js";
import { HttpError, isUniqueViolation } from "../../http-error.js";
import { hashPassword, verifyPassword } from "../../security/password.js";
import { hashToken, newToken } from "../../security/tokens.js";

export interface AuthServiceDeps {
  config: Config;
  pool: pg.Pool;
}

export interface RequestMeta {
  ip: string;
  userAgent?: string;
  correlationId: string;
}

export interface LoginResult {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  tenant: { id: string; name: string };
  role: TenantRole;
}

interface LoginLookupRow {
  id: string;
  password_hash: string;
  status: string;
}

const invalidCredentials = () => new HttpError(401, "CREDENCIAIS_INVALIDAS", "E-mail ou senha incorretos.");

export async function login(
  deps: AuthServiceDeps,
  input: { email: string; password: string; tenantId?: string },
  meta: RequestMeta,
): Promise<LoginResult> {
  const lookup = await deps.pool.query<LoginLookupRow>("SELECT * FROM app_login_lookup($1)", [input.email]);
  const found = lookup.rows[0];
  const passwordOk = await verifyPassword(found?.password_hash ?? null, input.password);

  if (!found || !passwordOk || found.status !== "ativo") {
    await withContext(deps.pool, {}, (db) =>
      recordAudit(db, { action: "login", outcome: "negado", correlationId: meta.correlationId, ip: meta.ip }));
    throw invalidCredentials();
  }

  const userId = found.id;
  const memberships = await withContext(deps.pool, { userId }, (db) =>
    db
      .select({
        tenantId: schema.memberships.tenantId,
        role: schema.memberships.role,
        status: schema.memberships.status,
        tenantName: schema.tenants.name,
        tenantStatus: schema.tenants.status,
      })
      .from(schema.memberships)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(eq(schema.memberships.userId, userId)));
  const usable = memberships.filter((m) => m.status === "ativo" && tenantCanOperate(m.tenantStatus as TenantStatus));

  let chosen = usable.length === 1 ? usable[0] : undefined;
  if (input.tenantId) chosen = usable.find((m) => m.tenantId === input.tenantId);
  if (!chosen && usable.length > 1 && !input.tenantId) {
    throw new HttpError(409, "SELECAO_DE_EMPRESA_NECESSARIA", "Informe a empresa para entrar.", {
      tenants: usable.map((m) => ({ id: m.tenantId, name: m.tenantName })),
    });
  }
  if (!chosen) throw invalidCredentials();

  const token = newToken();
  const csrfToken = newToken();
  const expiresAt = new Date(Date.now() + deps.config.sessionTtlMs);
  const tenantId = chosen.tenantId;
  await withContext(deps.pool, { tenantId, userId }, async (db) => {
    await db.insert(schema.sessions).values({
      tokenHash: hashToken(token),
      userId,
      tenantId,
      csrfToken,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 200),
    });
    await recordAudit(db, { tenantId, actorUserId: userId, action: "login", outcome: "ok", correlationId: meta.correlationId, ip: meta.ip });
  });
  return { token, csrfToken, expiresAt, tenant: { id: tenantId, name: chosen.tenantName }, role: chosen.role as TenantRole };
}

export async function logout(deps: AuthServiceDeps, auth: AuthContext, meta: RequestMeta): Promise<void> {
  await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
    await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, auth.sessionId));
    await recordAudit(db, { tenantId: auth.tenantId, actorUserId: auth.userId, action: "logout", outcome: "ok", correlationId: meta.correlationId, ip: meta.ip });
  });
}

/** Reconfirma a senha e renova a janela de autenticação recente da sessão. */
export async function reauthenticate(deps: AuthServiceDeps, auth: AuthContext, password: string, meta: RequestMeta): Promise<void> {
  const ok = await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
    const [user] = await db.select({ hash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, auth.userId)).limit(1);
    const valid = await verifyPassword(user?.hash ?? null, password);
    await recordAudit(db, {
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "reauth",
      outcome: valid ? "ok" : "negado",
      correlationId: meta.correlationId,
      ip: meta.ip,
    });
    if (valid) await db.update(schema.sessions).set({ lastAuthAt: new Date() }).where(eq(schema.sessions.id, auth.sessionId));
    return valid;
  });
  if (!ok) throw new HttpError(401, "SENHA_INVALIDA", "Senha incorreta.");
}

export interface ProvisionInput {
  tenantName: string;
  tradeName?: string;
  phone?: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
}

/** Cria empresa, proprietário e vínculo numa única transação: nunca fica empresa pela metade. */
export async function provisionTenant(deps: AuthServiceDeps, input: ProvisionInput, meta: RequestMeta) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const passwordHash = await hashPassword(input.ownerPassword);
  try {
    await withContext(deps.pool, { tenantId, userId }, async (db) => {
      await db.insert(schema.tenants).values({
        id: tenantId,
        name: input.tenantName,
        tradeName: input.tradeName,
        adminEmail: input.ownerEmail,
        phone: input.phone,
      });
      await db.insert(schema.users).values({ id: userId, email: input.ownerEmail, name: input.ownerName, passwordHash });
      await db.insert(schema.memberships).values({ tenantId, userId, role: "proprietario" });
      await recordAudit(db, {
        tenantId,
        actorUserId: userId,
        action: "tenant_provisioned",
        targetType: "tenant",
        targetId: tenantId,
        outcome: "ok",
        correlationId: meta.correlationId,
        ip: meta.ip,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "EMAIL_JA_CADASTRADO", "Este e-mail já está cadastrado.");
    throw error;
  }
  return { tenantId, userId };
}
