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
import { auditRoutes } from "./modules/audit/audit.routes.js";
import { masterRoutes } from "./modules/master/master.routes.js";
import { createMailer, type Mailer } from "./mail/mailer.js";
import { FailureThrottle } from "./security/throttle.js";
import { createWebHandler } from "./web-app.js";

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  storage?: FileStorage;
  clock?: () => Date;
  /** Envio de e-mail; os testes injetam um coletor em memória. Padrão: SMTP se configurado, senão desligado. */
  mailer?: Mailer;
  /** Destino dos logs (os testes o capturam para provar que segredos não aparecem). */
  logStream?: { write(chunk: string): void };
}

export async function buildApp({ config, pool, storage, clock, mailer, logStream }: AppDeps): Promise<FastifyInstance> {
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
            serializers: {
              // Só método, rota e origem. A query string leva buscas por nome, telefone e IMEI (dado pessoal) e não entra no log.
              // Também não entram os cabeçalhos (user-agent, referer etc.): o ID de correlação basta para diagnosticar.
              req(request: { method?: string; url?: string; socket?: { remoteAddress?: string } }) {
                return { method: request.method, url: (request.url ?? "").split("?")[0], remoteAddress: request.socket?.remoteAddress };
              },
            },
            ...(logStream ? { stream: logStream } : {}),
          },
  });

  // Em desenvolvimento (http://localhost) o padrão "upgrade-insecure-requests" quebraria os recursos; em produção segue ativo.
  // CSP: a interface não usa <style> embutido nem fontes externas. Estilos só do próprio site; 'unsafe-inline' fica
  // restrito a ATRIBUTOS style="" (a interface usa), nunca a blocos <style>. Fontes só locais.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        styleSrc: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'"],
        ...(config.cookieSecure ? {} : { upgradeInsecureRequests: null }),
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    // Recursos do navegador que o sistema não usa ficam desligados; a câmera é liberada só para o próprio site (leitura de QR).
    reply.header("permissions-policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
    // Defesa em profundidade contra CSRF (além de SameSite=Strict e do token): requisição que altera dados e vem
    // de OUTRA origem é recusada. Sem o cabeçalho Origin (ferramentas, testes) segue para as demais barreiras.
    const origin = request.headers.origin;
    if (origin && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).host === request.headers.host;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) {
        return reply.code(403).send({ error: { code: "ORIGEM_INVALIDA", message: "Origem da requisição não permitida." } });
      }
    }
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

  const deps: AppServices = { config, pool, storage: storage ?? new LocalDiskStorage(config.storageDir), clock: clock ?? (() => new Date()), loginThrottle: new FailureThrottle(config.loginAccountMaxFailures, 15 * 60 * 1000), mailer: mailer ?? createMailer(config), resetThrottle: new FailureThrottle(5, 15 * 60 * 1000, () => (clock ?? (() => new Date()))().getTime()), inviteThrottle: new FailureThrottle(30, 60 * 60 * 1000, () => (clock ?? (() => new Date()))().getTime()) };
  if (deps.mailer.enabled && !config.verificationSecret) throw new Error("VERIFICATION_SECRET é obrigatório quando o envio de e-mail está ligado");
  // O link de redefinição/convite é montado só com esta configuração, nunca com o cabeçalho Host da requisição.
  if (deps.mailer.enabled && !config.publicUrl) throw new Error("PUBLIC_URL é obrigatório quando o envio de e-mail está ligado");
  await app.register(authRoutes(deps), { prefix: "/api/v1" });
  if (config.masterEncKey) await app.register(masterRoutes(deps), { prefix: "/api/v1" });
  await app.register(teamRoutes(deps), { prefix: "/api/v1" });
  await app.register(auditRoutes(deps), { prefix: "/api/v1" });
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
