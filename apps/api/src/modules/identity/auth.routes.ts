import { schema, withContext } from "@reparo360/database";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyReply } from "fastify";
import { HttpError } from "../../http-error.js";
import { metaOf, requireContext } from "../../request-helpers.js";
import type { AppServices } from "../../services.js";
import { requireAuth, sessionCookieName } from "../../session-guard.js";
import { changePassword, login, logout, provisionTenant, reauthenticate } from "./auth.service.js";
import { confirmPasswordReset, requestPasswordReset } from "./password-reset.js";
import { changePasswordBody, confirmResetBody, loginBody, onboardingBody, reauthBody, requestResetBody } from "./schemas.js";

export function authRoutes(deps: AppServices) {
  const cookieName = sessionCookieName(deps.config);
  const guard = requireAuth(deps);
  // Estas rotas continuam abertas para quem ainda usa senha temporária.
  const guardTemporary = requireAuth(deps, { allowTemporaryPassword: true });
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

    // Público. Resposta idêntica exista ou não a conta (e com o limite atingido ou o envio desligado): ver password-reset.ts.
    app.post("/auth/password-reset/request", { config: attemptLimit }, async (request, reply) => {
      const { email } = requestResetBody.parse(request.body);
      await requestPasswordReset(deps, email, metaOf(request), request.log);
      return reply.code(202).header("cache-control", "no-store").send({ accepted: true });
    });

    app.post("/auth/password-reset/confirm", { config: attemptLimit }, async (request, reply) => {
      const body = confirmResetBody.parse(request.body);
      await confirmPasswordReset(deps, body.token, body.newPassword, metaOf(request));
      return reply.code(204).header("cache-control", "no-store").send();
    });

    /** A tela de entrada só mostra "Esqueci minha senha" quando o envio de e-mail está ligado. */
    app.get("/auth/options", async (_request, reply) =>
      reply.header("cache-control", "no-store").send({ passwordReset: deps.mailer.enabled && Boolean(deps.config.publicUrl) }));

    app.post("/auth/logout", { preHandler: guardTemporary }, async (request, reply) => {
      await logout(deps, requireContext(request), metaOf(request));
      clearCookie(reply);
      return reply.code(204).send();
    });

    app.post("/auth/reauth", { preHandler: guard, config: attemptLimit }, async (request, reply) => {
      const body = reauthBody.parse(request.body);
      await reauthenticate(deps, requireContext(request), body.password, metaOf(request));
      return reply.code(204).send();
    });

    app.post("/auth/change-password", { preHandler: guardTemporary, config: attemptLimit }, async (request, reply) => {
      await changePassword(deps, requireContext(request), changePasswordBody.parse(request.body), metaOf(request));
      return reply.code(204).send();
    });

    app.get("/me", { preHandler: guardTemporary }, async (request) => {
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
      return { user: { id: auth.userId, ...row.user }, tenant: row.tenant, role: auth.role, csrfToken: auth.csrfToken, senhaTemporaria: auth.mustChangePassword };
    });
  };
}
