import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError } from "../../http-error.js";
import { metaOf } from "../../request-helpers.js";
import { safeEqual } from "../../security/tokens.js";
import type { AppServices } from "../../services.js";
import {
  createTenant, listTenants, masterLogout, masterMfaStep, masterPasswordStep, masterReauth, resolveMasterSession, setTenantStatus, type MasterContext,
} from "./master.service.js";

declare module "fastify" {
  interface FastifyRequest {
    master: MasterContext | null;
  }
}

const email = z.email().max(254).transform((value) => value.trim().toLowerCase());
const passwordBody = z.strictObject({ email, password: z.string().min(1).max(128) });
const mfaBody = z.strictObject({ challenge: z.string().min(20).max(100), code: z.string().regex(/^\d{6}$/) });
const reauthBody = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
const tenantParams = z.strictObject({ tenantId: z.uuid() });
const statusBody = z.strictObject({ status: z.enum(["ativa", "suspensa"]), reason: z.string().trim().min(5).max(300) });

const newTenantBody = z.strictObject({
  tenantName: z.string().trim().min(2).max(120),
  tradeName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(8).max(30).optional(),
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: email,
});

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const masterCookieName = (secure: boolean) => (secure ? "__Host-r360_master" : "r360_master");

/** Rotas do Master. Só são registradas com MASTER_ENC_KEY: sem a chave, nem existem (404). */
export function masterRoutes(deps: AppServices) {
  const cookieName = masterCookieName(deps.config.cookieSecure);
  const attemptLimit = { rateLimit: { max: deps.config.loginRateLimitMax, timeWindow: "1 minute" } };
  const cookieOptions = { path: "/", httpOnly: true, secure: deps.config.cookieSecure, sameSite: "strict" as const };

  async function guard(request: FastifyRequest): Promise<void> {
    const auth = await resolveMasterSession(deps, request.cookies[cookieName]);
    if (!SAFE_METHODS.has(request.method)) {
      const header = request.headers["x-csrf-token"];
      if (typeof header !== "string" || !safeEqual(header, auth.csrfToken)) {
        throw new HttpError(403, "CSRF_INVALIDO", "Token CSRF ausente ou inválido.");
      }
    }
    request.master = auth;
  }
  const current = (request: FastifyRequest): MasterContext => {
    if (!request.master) throw new HttpError(401, "NAO_AUTENTICADO", "Sessão ausente ou expirada.");
    return request.master;
  };
  const noStore = (reply: FastifyReply) => reply.header("cache-control", "no-store");

  return async function register(app: FastifyInstance): Promise<void> {
    app.decorateRequest("master", null);

    app.post("/master/auth/login", { config: attemptLimit }, async (request, reply) => {
      return noStore(reply).send(await masterPasswordStep(deps, passwordBody.parse(request.body), metaOf(request)));
    });

    app.post("/master/auth/mfa", { config: attemptLimit }, async (request, reply) => {
      const result = await masterMfaStep(deps, mfaBody.parse(request.body), metaOf(request));
      reply.setCookie(cookieName, result.token, { ...cookieOptions, expires: result.expiresAt });
      return noStore(reply).send({ csrfToken: result.csrfToken });
    });

    app.post("/master/auth/logout", { preHandler: guard }, async (request, reply) => {
      await masterLogout(deps, current(request), metaOf(request));
      reply.clearCookie(cookieName, cookieOptions);
      return reply.code(204).send();
    });

    app.post("/master/auth/reauth", { preHandler: guard, config: attemptLimit }, async (request, reply) => {
      await masterReauth(deps, current(request), reauthBody.parse(request.body).code, metaOf(request));
      return reply.code(204).send();
    });

    app.get("/master/me", { preHandler: guard }, async (request, reply) => {
      const auth = current(request);
      return noStore(reply).send({ admin: { id: auth.adminId, name: auth.name, email: auth.email }, csrfToken: auth.csrfToken });
    });

    app.get("/master/tenants", { preHandler: guard }, async (request, reply) => {
      return noStore(reply).send({ tenants: await listTenants(deps, current(request)) });
    });

    app.post("/master/tenants", { preHandler: guard }, async (request, reply) => {
      const created = await createTenant(deps, current(request), newTenantBody.parse(request.body), metaOf(request));
      return noStore(reply).code(201).send(created);
    });

    app.post("/master/tenants/:tenantId/status", { preHandler: guard }, async (request, reply) => {
      const { tenantId } = tenantParams.parse(request.params);
      await setTenantStatus(deps, current(request), tenantId, statusBody.parse(request.body), metaOf(request));
      return reply.code(204).send();
    });
  };
}
