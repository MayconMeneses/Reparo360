import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { ZodError } from "zod";
import "./auth-context.js";
import type { Config } from "./config.js";
import { HttpError } from "./http-error.js";
import { authRoutes } from "./modules/identity/auth.routes.js";
import { attachmentRoutes } from "./modules/attachments/attachments.routes.js";
import { LocalDiskStorage, type FileStorage } from "./modules/attachments/storage.js";
import { benchRoutes } from "./modules/bench/bench.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.js";
import { customerRoutes } from "./modules/customers/customers.routes.js";
import { deliveryRoutes } from "./modules/delivery/delivery.js";
import { deviceRoutes } from "./modules/devices/devices.routes.js";
import { diagnosticRoutes } from "./modules/diagnostics/diagnostics.js";
import { documentRoutes } from "./modules/documents/documents.routes.js";
import { listRoutes } from "./modules/lists/lists.routes.js";
import { portalRoutes } from "./modules/portal/portal.js";
import { quoteRoutes } from "./modules/quotes/quotes.routes.js";
import { tenantRoutes } from "./modules/tenant/tenant.routes.js";
import { technicianRoutes } from "./modules/team/technicians.routes.js";
import { teamRoutes } from "./modules/team/team.routes.js";
import { workOrderRoutes } from "./modules/work-orders/work-orders.routes.js";
import type { AppServices } from "./services.js";
import { createWebHandler } from "./web-app.js";

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  storage?: FileStorage;
  clock?: () => Date;
  /** Destino dos logs (os testes o capturam para provar que segredos não aparecem). */
  logStream?: { write(chunk: string): void };
}

export async function buildApp({ config, pool, storage, clock, logStream }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 100 * 1024,
    genReqId: () => randomUUID(),
    trustProxy: config.trustProxy,
    logger:
      config.logLevel === "silent"
        ? false
        : {
            level: config.logLevel,
            // Credenciais nunca vão para o log.
            redact: { paths: ["req.headers.cookie", "req.headers.authorization", 'req.headers["x-csrf-token"]', 'req.headers["x-portal-token"]'], remove: true },
            ...(logStream ? { stream: logStream } : {}),
          },
  });

  // Em desenvolvimento (http://localhost) o padrão "upgrade-insecure-requests" quebraria os recursos; em produção segue ativo.
  await app.register(helmet, config.cookieSecure ? {} : { contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  app.addHook("onSend", async (_request, reply) => {
    // Respostas da API nunca são guardadas; arquivos da interface definem a própria política.
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
      return reply.code(400).send({ error: { code: "VALIDACAO", message: "Dados inválidos.", details: { issues } } });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413) {
      return reply.code(413).send({ error: { code: "ARQUIVO_GRANDE_DEMAIS", message: "Conteúdo acima do limite permitido." } });
    }
    if (status === 415) {
      return reply.code(415).send({ error: { code: "TIPO_NAO_SUPORTADO", message: "Tipo de conteúdo não suportado." } });
    }
    if (status === 429) {
      return reply.code(429).send({ error: { code: "MUITAS_TENTATIVAS", message: "Muitas tentativas. Aguarde e tente novamente." } });
    }
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: "REQUISICAO_INVALIDA", message: "Requisição inválida." } });
    }
    request.log.error({ err: error }, "erro não tratado");
    return reply.code(500).send({ error: { code: "ERRO_INTERNO", message: "Erro interno.", correlationId: request.id } });
  });

  const webHandler = config.webDist ? await createWebHandler(config.webDist) : null;
  app.setNotFoundHandler((request, reply) => {
    const isWebRequest = webHandler && (request.method === "GET" || request.method === "HEAD") && !request.url.startsWith("/api/");
    if (isWebRequest) return webHandler(request, reply);
    return reply.code(404).send({ error: { code: "NAO_ENCONTRADO", message: "Recurso não encontrado." } });
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "indisponivel" });
    }
  });

  const deps: AppServices = { config, pool, storage: storage ?? new LocalDiskStorage(config.storageDir), clock: clock ?? (() => new Date()) };
  await app.register(authRoutes(deps), { prefix: "/api/v1" });
  await app.register(teamRoutes(deps), { prefix: "/api/v1" });
  await app.register(customerRoutes(deps), { prefix: "/api/v1" });
  await app.register(deviceRoutes(deps), { prefix: "/api/v1" });
  await app.register(workOrderRoutes(deps), { prefix: "/api/v1" });
  await app.register(attachmentRoutes(deps), { prefix: "/api/v1" });
  await app.register(documentRoutes(deps), { prefix: "/api/v1" });
  await app.register(diagnosticRoutes(deps), { prefix: "/api/v1" });
  await app.register(quoteRoutes(deps), { prefix: "/api/v1" });
  await app.register(benchRoutes(deps), { prefix: "/api/v1" });
  await app.register(deliveryRoutes(deps), { prefix: "/api/v1" });
  await app.register(tenantRoutes(deps), { prefix: "/api/v1" });
  await app.register(listRoutes(deps), { prefix: "/api/v1" });
  await app.register(technicianRoutes(deps), { prefix: "/api/v1" });
  await app.register(dashboardRoutes(deps), { prefix: "/api/v1" });
  await app.register(portalRoutes(deps), { prefix: "/api/v1" });
  return app;
}
