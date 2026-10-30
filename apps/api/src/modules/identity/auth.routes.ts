import { schema, withContext } from "@reparo360/database";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { HttpError } from "../../http-error.js";
import { metaOf, requireContext } from "../../request-helpers.js";
import { requireAuth, sessionCookieName, type GuardDeps } from "../../session-guard.js";
import { login, logout, provisionTenant, reauthenticate } from "./auth.service.js";
import { loginBody, onboardingBody, reauthBody } from "./schemas.js";

export function authRoutes(deps: GuardDeps) {
  const cookieName = sessionCookieName(deps.config);
  const guard = requireAuth(deps);
  const attemptLimit = {
    rateLimit: { max: deps.config.loginRateLimitMax, timeWindow: "1 minute" },
  };

  const clearCookie = (reply: FastifyReply) =>
    reply.clearCookie(cookieName, { path: "/", httpOnly: true, secure: deps.config.cookieSecure, sameSite: "strict" });

  return async function register(app: FastifyInstance): Promise<void> {
    app.post("/tenants", { config: attemptLimit }, async (request, reply) => {
      if (!deps.config.allowPublicOnboarding) {
        throw new HttpError(403, "CADASTRO_DESABILITADO", "O cadastro de novas assistências não está habilitado.");
      }
      const body = onboardingBody.parse(request.body);
      const { tenantId, userId } = await provisionTenant(deps, body, metaOf(request));
      return reply.code(201).send({ tenant: { id: tenantId, name: body.tenantName }, owner: { id: userId } });
    });

    app.post("/auth/login", { config: attemptLimit }, async (request, reply) => {
      const body = loginBody.parse(request.body);
      const result = await login(deps, body, metaOf(request));
      reply.setCookie(cookieName, result.token, {
        path: "/",
        httpOnly: true,
        secure: deps.config.cookieSecure,
        sameSite: "strict",
        expires: result.expiresAt,
      });
      return reply.send({ csrfToken: result.csrfToken, tenant: result.tenant, role: result.role });
    });

    app.post("/auth/logout", { preHandler: guard }, async (request, reply) => {
      await logout(deps, requireContext(request), metaOf(request));
      clearCookie(reply);
      return reply.code(204).send();
    });

    app.post("/auth/reauth", { preHandler: guard, config: attemptLimit }, async (request, reply) => {
      const body = reauthBody.parse(request.body);
      await reauthenticate(deps, requireContext(request), body.password, metaOf(request));
      return reply.code(204).send();
    });

    app.get("/me", { preHandler: guard }, async (request) => {
      const auth = requireContext(request);
      const row = await withContext(deps.pool, { tenantId: auth.tenantId, userId: auth.userId }, async (db) => {
        const [user] = await db
          .select({ name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, auth.userId))
          .limit(1);
        const [tenant] = await db
          .select({ id: schema.tenants.id, name: schema.tenants.name })
          .from(schema.tenants)
          .where(eq(schema.tenants.id, auth.tenantId))
          .limit(1);
        return { user, tenant };
      });
      return { user: { id: auth.userId, ...row.user }, tenant: row.tenant, role: auth.role, csrfToken: auth.csrfToken };
    });
  };
}
