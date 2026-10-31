import { z } from "zod";

const booleanFlag = (fallback: "true" | "false") =>
  z.enum(["true", "false"]).default(fallback).transform((value) => value === "true");

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  STORAGE_DIR: z.string().min(1),
  /** Pasta do build da interface (apps/web/dist). Vazia: a API não serve a interface. */
  WEB_DIST: z.string().optional(),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  COOKIE_SECURE: booleanFlag("true"),
  ALLOW_PUBLIC_ONBOARDING: booleanFlag("false"),
  TRUST_PROXY: booleanFlag("false"),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  PORTAL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug"]).default("info"),
});

export interface Config {
  databaseUrl: string;
  /** Pasta privada dos anexos: fora de pastas sincronizadas (OneDrive) e nunca servida diretamente. */
  storageDir: string;
  webDist?: string;
  host: string;
  port: number;
  cookieSecure: boolean;
  allowPublicOnboarding: boolean;
  trustProxy: boolean;
  loginRateLimitMax: number;
  portalRateLimitMax: number;
  /** Validade do link do consumidor (P-32). */
  portalLinkTtlDays: number;
  logLevel: "silent" | "fatal" | "error" | "warn" | "info" | "debug";
  /** Validade absoluta da sessão. */
  sessionTtlMs: number;
  /** Inatividade máxima antes de a sessão expirar. */
  sessionIdleMs: number;
  /** Janela em que a autenticação é considerada recente para operações sensíveis. */
  recentAuthMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  return {
    databaseUrl: parsed.DATABASE_URL,
    storageDir: parsed.STORAGE_DIR,
    webDist: parsed.WEB_DIST,
    host: parsed.HOST,
    port: parsed.PORT,
    cookieSecure: parsed.COOKIE_SECURE,
    allowPublicOnboarding: parsed.ALLOW_PUBLIC_ONBOARDING,
    trustProxy: parsed.TRUST_PROXY,
    loginRateLimitMax: parsed.LOGIN_RATE_LIMIT_MAX,
    portalRateLimitMax: parsed.PORTAL_RATE_LIMIT_MAX,
    portalLinkTtlDays: 30,
    logLevel: parsed.LOG_LEVEL,
    sessionTtlMs: 12 * 60 * 60 * 1000,
    sessionIdleMs: 2 * 60 * 60 * 1000,
    recentAuthMs: 10 * 60 * 1000,
  };
}
