import { schema, withContext } from "@reparo360/database";
import { hasPermission, requiresRecentAuth, tenantCanOperate, type Permission, type TenantRole, type TenantStatus } from "@reparo360/domain";
import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type pg from "pg";
import type { AuthContext } from "./auth-context.js";
import type { Config } from "./config.js";
import { HttpError } from "./http-error.js";
import { hashToken, safeEqual } from "./security/tokens.js";

export interface GuardDeps {
  config: Config;
  pool: pg.Pool;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LAST_SEEN_REFRESH_MS = 60_000;

export function sessionCookieName(config: Config): string {
  // O prefixo __Host- obriga Secure, Path=/ e ausência de Domain.
  return config.cookieSecure ? "__Host-r360_session" : "r360_session";
}

const unauthenticated = () => new HttpError(401, "NAO_AUTENTICADO", "Sessão ausente ou expirada.");

async function resolveSession(deps: GuardDeps, request: FastifyRequest): Promise<AuthContext> {
  const token = request.cookies[sessionCookieName(deps.config)];
  if (!token) throw unauthenticated();

  const sessionHash = hashToken(token);
  const session = await withContext(deps.pool, { sessionHash }, async (db) => {
    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, sessionHash)).limit(1);
    return rows[0];
  });
  const now = Date.now();
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt.getTime() <= now ||
    session.lastSeenAt.getTime() + deps.config.sessionIdleMs <= now
  ) {
    throw unauthenticated();
  }

  // Revalida vínculo, status do usuário e da empresa a cada requisição:
  // desativar um membro ou suspender a empresa vale imediatamente.
  const role = await withContext(deps.pool, { tenantId: session.tenantId, userId: session.userId }, async (db) => {
    const [member] = await db
      .select({ role: schema.memberships.role, status: schema.memberships.status, tenantStatus: schema.tenants.status })
      .from(schema.memberships)
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
      .where(and(eq(schema.memberships.tenantId, session.tenantId), eq(schema.memberships.userId, session.userId)))
      .limit(1);
    const [user] = await db.select({ status: schema.users.status, mustChange: schema.users.mustChangePassword }).from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
    if (!member || member.status !== "ativo" || user?.status !== "ativo") return null;
    if (!tenantCanOperate(member.tenantStatus as TenantStatus)) return null;
    if (now - session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
      await db.update(schema.sessions).set({ lastSeenAt: new Date(now) }).where(eq(schema.sessions.id, session.id));
    }
    return { role: member.role as TenantRole, mustChange: user.mustChange };
  });
  if (!role) throw unauthenticated();

  return {
    sessionId: session.id,
    userId: session.userId,
    tenantId: session.tenantId,
    role: role.role,
    csrfToken: session.csrfToken,
    lastAuthAt: session.lastAuthAt,
    mustChangePassword: role.mustChange,
  };
}

/**
 * Cria o preHandler que autentica, valida CSRF em métodos mutáveis e aplica a
 * permissão exigida. A decisão é sempre do servidor; o frontend só reflete.
 */
export function requireAuth(deps: GuardDeps, options: { permission?: Permission; allowTemporaryPassword?: boolean } = {}) {
  return async function guard(request: FastifyRequest): Promise<void> {
    const auth = await resolveSession(deps, request);

    if (!SAFE_METHODS.has(request.method)) {
      const header = request.headers["x-csrf-token"];
      if (typeof header !== "string" || !safeEqual(header, auth.csrfToken)) {
        throw new HttpError(403, "CSRF_INVALIDO", "Token CSRF ausente ou inválido.");
      }
    }

    // Senha temporária: todo o resto do sistema fica fechado até a troca (só /me, sair e trocar a senha passam).
    if (auth.mustChangePassword && !options.allowTemporaryPassword) {
      throw new HttpError(403, "TROCA_DE_SENHA_OBRIGATORIA", "Defina uma nova senha para continuar.");
    }
    const { permission } = options;
    if (permission) {
      if (!hasPermission(auth.role, permission)) {
        throw new HttpError(403, "PERMISSAO_NEGADA", "Você não tem permissão para esta ação.");
      }
      if (requiresRecentAuth(permission) && Date.now() - auth.lastAuthAt.getTime() > deps.config.recentAuthMs) {
        throw new HttpError(403, "REAUTENTICACAO_NECESSARIA", "Confirme sua senha para continuar.");
      }
    }
    request.auth = auth;
  };
}
