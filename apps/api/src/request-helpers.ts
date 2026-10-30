import type { FastifyRequest } from "fastify";
import type { AuthContext } from "./auth-context.js";
import { HttpError } from "./http-error.js";
import type { RequestMeta } from "./modules/identity/auth.service.js";

export function metaOf(request: FastifyRequest): RequestMeta {
  return { ip: request.ip, userAgent: request.headers["user-agent"], correlationId: request.id };
}

/** Só usar em rotas protegidas por `requireAuth`, que preenche `request.auth`. */
export function requireContext(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new HttpError(401, "NAO_AUTENTICADO", "Sessão ausente ou expirada.");
  return request.auth;
}
