import type { TenantRole } from "@reparo360/domain";

/** Identidade resolvida no servidor a partir da sessão. Nunca vem do corpo ou da URL. */
export interface AuthContext {
  sessionId: string;
  userId: string;
  tenantId: string;
  role: TenantRole;
  csrfToken: string;
  lastAuthAt: Date;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}
