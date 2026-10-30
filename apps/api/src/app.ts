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
import { teamRoutes } from "./modules/team/team.routes.js";

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
}

export async function buildApp({ config, pool }: AppDeps): Promise<FastifyInstance> {
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
            redact: { paths: ["req.headers.cookie", "req.headers.authorization", 'req.headers["x-csrf-token"]'], remove: true },
          },
  });

  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  app.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
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
    if (status === 429) {
      return reply.code(429).send({ error: { code: "MUITAS_TENTATIVAS", message: "Muitas tentativas. Aguarde e tente novamente." } });
    }
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: "REQUISICAO_INVALIDA", message: "Requisição inválida." } });
    }
    request.log.error({ err: error }, "erro não tratado");
    return reply.code(500).send({ error: { code: "ERRO_INTERNO", message: "Erro interno.", correlationId: request.id } });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: "NAO_ENCONTRADO", message: "Recurso não encontrado." } }));

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "indisponivel" });
    }
  });

  const deps = { config, pool };
  await app.register(authRoutes(deps), { prefix: "/api/v1" });
  await app.register(teamRoutes(deps), { prefix: "/api/v1" });
  return app;
}
