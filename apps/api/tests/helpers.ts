import { randomUUID } from "node:crypto";
import { createPool, runMigrations, schema, withContext } from "@reparo360/database";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";

export const PASSWORD = "senha-sintetica-123";
export const COOKIE_NAME = "__Host-r360_session";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não definida (copie .env.example para .env)`);
  return value;
}

export interface TestEnv {
  app: FastifyInstance;
  /** Papel da aplicação, usado pela própria API. */
  pool: pg.Pool;
  /** Papel migrador: só para inspecionar/alterar estado nos testes. */
  migrator: pg.Pool;
  close: () => Promise<void>;
}

export async function startTestEnv(overrides: Record<string, string> = {}): Promise<TestEnv> {
  await runMigrations(requireEnv("TEST_MIGRATION_DATABASE_URL"));
  const config: Config = loadConfig({
    DATABASE_URL: requireEnv("TEST_DATABASE_URL"),
    COOKIE_SECURE: "true",
    ALLOW_PUBLIC_ONBOARDING: "true",
    LOGIN_RATE_LIMIT_MAX: "1000",
    LOG_LEVEL: "silent",
    ...overrides,
  });
  const pool = createPool(config.databaseUrl, 5);
  const migrator = createPool(requireEnv("TEST_MIGRATION_DATABASE_URL"), 2);
  const app = await buildApp({ config, pool });
  return {
    app,
    pool,
    migrator,
    close: async () => {
      await app.close();
      await pool.end();
      await migrator.end();
    },
  };
}

export async function resetData(migrator: pg.Pool): Promise<void> {
  await migrator.query("TRUNCATE audit_events, sessions, memberships, users, tenants CASCADE");
}

export interface Account {
  tenantId: string;
  userId: string;
  email: string;
}

export interface Session {
  cookie: string;
  csrf: string;
  tenantId: string;
}

export async function onboard(env: TestEnv, label: string): Promise<Account> {
  // A API normaliza e-mails para minúsculas; o fixture já nasce assim para comparações exatas.
  const email = `${label}-${randomUUID().slice(0, 8)}@teste.invalid`.toLowerCase();
  const res = await env.app.inject({
    method: "POST",
    url: "/api/v1/tenants",
    payload: { tenantName: `Assistência ${label}`, ownerName: `Dono ${label}`, ownerEmail: email, ownerPassword: PASSWORD },
  });
  if (res.statusCode !== 201) throw new Error(`onboarding falhou: ${res.statusCode} ${res.body}`);
  const body = res.json<{ tenant: { id: string }; owner: { id: string } }>();
  return { tenantId: body.tenant.id, userId: body.owner.id, email };
}

export async function login(env: TestEnv, email: string, tenantId?: string, password = PASSWORD) {
  const res = await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password, tenantId } });
  const cookie = res.cookies.find((c) => c.name === COOKIE_NAME);
  const session: Session | null =
    res.statusCode === 200 && cookie
      ? { cookie: `${COOKIE_NAME}=${cookie.value}`, csrf: res.json<{ csrfToken: string }>().csrfToken, tenantId: tenantId ?? "" }
      : null;
  return { res, session, rawToken: cookie?.value };
}

export async function loginOk(env: TestEnv, email: string, tenantId?: string): Promise<Session> {
  const { res, session } = await login(env, email, tenantId);
  if (!session) throw new Error(`login falhou: ${res.statusCode} ${res.body}`);
  return session;
}

export function call(env: TestEnv, session: Session | null, method: "GET" | "POST" | "PATCH", url: string, payload?: object) {
  const headers: Record<string, string> = {};
  if (session) {
    headers.cookie = session.cookie;
    headers["x-csrf-token"] = session.csrf;
  }
  return env.app.inject({ method, url: `/api/v1${url}`, headers, payload });
}

/** Cria um membro na empresa do `owner` e devolve o e-mail e o id. */
export async function addMember(env: TestEnv, owner: Session, role: string, label = role) {
  const email = `${label}-${randomUUID().slice(0, 8)}@teste.invalid`.toLowerCase();
  const res = await call(env, owner, "POST", "/team/members", { name: `Membro ${label}`, email, password: PASSWORD, role });
  if (res.statusCode !== 201) throw new Error(`addMember falhou: ${res.statusCode} ${res.body}`);
  return { email, userId: res.json<{ userId: string }>().userId };
}

export function sessionsOf(env: TestEnv, tenantId: string) {
  return withContext(env.migrator, { tenantId }, (db) => db.select().from(schema.sessions));
}
