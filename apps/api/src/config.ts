import { z } from "zod";

const booleanFlag = (fallback: "true" | "false") =>
  z.enum(["true", "false"]).default(fallback).transform((value) => value === "true");

const baseEnvSchema = z.object({
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
  LOGIN_ACCOUNT_MAX_FAILURES: z.coerce.number().int().positive().default(8),
  PORTAL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug"]).default("info"),
  /** Envio de e-mail (código da aprovação remota, P-03). Sem isto, só a aprovação presencial existe. */
  SMTP_URL: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).optional(),
  /** Chave do HMAC dos códigos de verificação. Obrigatória quando há envio de e-mail. */
  VERIFICATION_SECRET: z.string().min(32).optional(),
  /** Chave (64 hex = 256 bits) que cifra o segredo MFA do Master. Sem ela, as rotas do Master ficam desligadas. */
  /** Endereço público do sistema (https://…), usado para montar links de e-mail. NUNCA vem da requisição. */
  PUBLIC_URL: z.url().optional(),
  MASTER_ENC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "64 caracteres hexadecimais").optional(),
});

const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  if (env.SMTP_URL && !env.MAIL_FROM) ctx.addIssue({ code: "custom", path: ["MAIL_FROM"], message: "obrigatório com SMTP_URL" });
  if (env.SMTP_URL && !env.PUBLIC_URL) ctx.addIssue({ code: "custom", path: ["PUBLIC_URL"], message: "obrigatório com SMTP_URL (endereço público do sistema)" });
  if (env.SMTP_URL && !env.VERIFICATION_SECRET) ctx.addIssue({ code: "custom", path: ["VERIFICATION_SECRET"], message: "obrigatório com SMTP_URL (mínimo 32 caracteres)" });
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
  /** Falhas de login por IP e conta em 15 min antes de bloquear aquela combinação. */
  loginAccountMaxFailures: number;
  portalRateLimitMax: number;
  /** Validade do link do consumidor (P-32). */
  portalLinkTtlDays: number;
  smtpUrl?: string;
  mailFrom?: string;
  verificationSecret?: string;
  publicUrl?: string;
  /** Master: ligado só com chave de cifragem. Prazos mais curtos que os da empresa (proposta, P-45). */
  masterEncKey?: Buffer;
  masterSessionTtlMs: number;
  masterIdleMs: number;
  masterRecentAuthMs: number;
  masterChallengeTtlMs: number;
  masterChallengeMaxAttempts: number;
  /** Validade do código de verificação e limites contra tentativa de adivinhar (P-03). */
  verificationTtlMs: number;
  verificationMaxAttempts: number;
  verificationMinIntervalMs: number;
  verificationMaxPerHour: number;
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
    loginAccountMaxFailures: parsed.LOGIN_ACCOUNT_MAX_FAILURES,
    portalRateLimitMax: parsed.PORTAL_RATE_LIMIT_MAX,
    portalLinkTtlDays: 30,
    smtpUrl: parsed.SMTP_URL,
    mailFrom: parsed.MAIL_FROM,
    verificationSecret: parsed.VERIFICATION_SECRET,
    publicUrl: parsed.PUBLIC_URL?.replace(/\/+$/, ""),
    masterEncKey: parsed.MASTER_ENC_KEY ? Buffer.from(parsed.MASTER_ENC_KEY, "hex") : undefined,
    masterSessionTtlMs: 4 * 60 * 60 * 1000,
    masterIdleMs: 30 * 60 * 1000,
    masterRecentAuthMs: 5 * 60 * 1000,
    masterChallengeTtlMs: 5 * 60 * 1000,
    masterChallengeMaxAttempts: 5,
    verificationTtlMs: 10 * 60 * 1000,
    verificationMaxAttempts: 5,
    verificationMinIntervalMs: 60 * 1000,
    verificationMaxPerHour: 5,
    logLevel: parsed.LOG_LEVEL,
    sessionTtlMs: 12 * 60 * 60 * 1000,
    sessionIdleMs: 2 * 60 * 60 * 1000,
    recentAuthMs: 10 * 60 * 1000,
  };
}
