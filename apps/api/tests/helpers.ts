import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool, runMigrations, schema, withContext } from "@reparo360/database";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildApp } from "../src/app.js";
import type { Mailer } from "../src/mail/mailer.js";
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
  /** Pasta temporária dos anexos deste ambiente de teste. */
  storageDir: string;
  close: () => Promise<void>;
}

export async function startTestEnv(overrides: Record<string, string> = {}, clock?: () => Date, logStream?: { write(chunk: string): void }, mailer?: Mailer): Promise<TestEnv> {
  const storageDir = await mkdtemp(join(tmpdir(), "reparo360-test-"));
  await runMigrations(requireEnv("TEST_MIGRATION_DATABASE_URL"));
  const config: Config = loadConfig({
    DATABASE_URL: requireEnv("TEST_DATABASE_URL"),
    STORAGE_DIR: storageDir,
    COOKIE_SECURE: "true",
    ALLOW_PUBLIC_ONBOARDING: "true",
    LOGIN_RATE_LIMIT_MAX: "1000",
    LOG_LEVEL: "silent",
    ...overrides,
  });
  const pool = createPool(config.databaseUrl, 5);
  const migrator = createPool(requireEnv("TEST_MIGRATION_DATABASE_URL"), 2);
  const app = await buildApp({ config, pool, clock, logStream, mailer });
  return {
    app,
    pool,
    migrator,
    storageDir,
    close: async () => {
      await app.close();
      await pool.end();
      await migrator.end();
      await rm(storageDir, { recursive: true, force: true });
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

export function call(env: TestEnv, session: Session | null, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders };
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

// --- Fase 2 -----------------------------------------------------------------

export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("conteudo sintetico de imagem")]);
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("conteudo sintetico")]);

export async function newCustomer(env: TestEnv, session: Session, name = "Maria Teste", phone = "(85) 99999-1234") {
  const res = await call(env, session, "POST", "/customers", { name, phone, confirmDuplicate: true });
  if (res.statusCode !== 201) throw new Error(`cliente falhou: ${res.statusCode} ${res.body}`);
  return res.json<{ id: string }>().id;
}

export async function newDevice(env: TestEnv, session: Session, customerId: string, extra: object = {}) {
  const res = await call(env, session, "POST", `/customers/${customerId}/devices`, { category: "celular", brand: "Marca", model: "Modelo X", ...extra });
  if (res.statusCode !== 201) throw new Error(`equipamento falhou: ${res.statusCode} ${res.body}`);
  return res.json<{ id: string }>().id;
}

export const inspectionPayload = (overrides: object = {}) => ({
  physicalCondition: "Tela trincada no canto superior.",
  accessories: ["carregador"],
  checklist: [{ item: "Tela", result: "com_defeito" }, { item: "Câmera", result: "nao_testado" }],
  passwordInformed: false,
  ...overrides,
});

export async function openOrder(env: TestEnv, session: Session, customerId: string, deviceId: string, extra: object = {}, headers: Record<string, string> = {}) {
  return call(env, session, "POST", "/work-orders", {
    customerId, deviceId, reportedDefect: "Não liga", inspection: inspectionPayload(), ...extra,
  }, headers);
}

/** Cliente + equipamento + OS prontos; devolve os ids. */
export async function setupOrder(env: TestEnv, session: Session, extra: object = {}) {
  const customerId = await newCustomer(env, session);
  const deviceId = await newDevice(env, session, customerId);
  const res = await openOrder(env, session, customerId, deviceId, extra);
  if (res.statusCode !== 201) throw new Error(`OS falhou: ${res.statusCode} ${res.body}`);
  const { id, protocol, version } = res.json<{ id: string; protocol: string; version: number }>();
  return { customerId, deviceId, orderId: id, protocol, version };
}

export function upload(env: TestEnv, session: Session, orderId: string, contentType: string, body: Buffer) {
  return env.app.inject({
    method: "POST",
    url: `/api/v1/work-orders/${orderId}/attachments`,
    headers: { cookie: session.cookie, "x-csrf-token": session.csrf, "content-type": contentType },
    payload: body,
  });
}

// --- Fase 3 -----------------------------------------------------------------

export async function orderDetail(env: TestEnv, session: Session, orderId: string) {
  return (await call(env, session, "GET", `/work-orders/${orderId}`)).json();
}

/** Aplica uma transição direta lendo a versão atual da OS. */
export async function transition(env: TestEnv, session: Session, orderId: string, action: string, reason?: string) {
  const { version } = await orderDetail(env, session, orderId);
  return call(env, session, "POST", `/work-orders/${orderId}/transitions`, { action, expectedVersion: version, reason });
}

export const goodDiagnostic = (extra: object = {}) => ({
  nature: "confirmado", symptoms: "Não carrega", checksPerformed: "Teste de carga e multímetro", findings: "Bateria viciada", ...extra,
});

export const goodQuote = (extra: object = {}) => ({
  items: [
    { kind: "peca", description: "Bateria", quantity: 1, unitPriceCents: 15000 },
    { kind: "servico", description: "Mão de obra", quantity: 2, unitPriceCents: 4590 },
  ],
  discountCents: 0,
  paymentTerms: "À vista ou cartão em até 3x",
  estimatedDays: 3,
  ...extra,
});

/** OS aberta, com técnico atribuído e já em EM_DIAGNOSTICO. */
export async function orderInDiagnosis(env: TestEnv, owner: Session) {
  const tech = await addMember(env, owner, "tecnico");
  const techSession = await loginOk(env, tech.email);
  const order = await setupOrder(env, owner, { technicianId: tech.userId });
  const started = await transition(env, owner, order.orderId, "iniciar_diagnostico");
  if (started.statusCode !== 200) throw new Error(`iniciar_diagnostico falhou: ${started.statusCode} ${started.body}`);
  return { ...order, tech, techSession };
}

export async function diagnose(env: TestEnv, session: Session, orderId: string, extra: object = {}) {
  const res = await call(env, session, "POST", `/work-orders/${orderId}/diagnostics`, goodDiagnostic(extra));
  if (res.statusCode !== 201) throw new Error(`diagnóstico falhou: ${res.statusCode} ${res.body}`);
  return res.json();
}

/** Rascunho criado e enviado. Devolve a versão enviada. */
export async function sendQuote(env: TestEnv, session: Session, orderId: string, quoteExtra: object = {}) {
  const created = await call(env, session, "POST", `/work-orders/${orderId}/quotes`, goodQuote(quoteExtra));
  if (created.statusCode !== 201) throw new Error(`rascunho falhou: ${created.statusCode} ${created.body}`);
  const draft = created.json<{ id: string; revision: number }>();
  const sent = await call(env, session, "POST", `/quotes/${draft.id}/submit`, { revision: draft.revision });
  if (sent.statusCode !== 200) throw new Error(`envio falhou: ${sent.statusCode} ${sent.body}`);
  return sent.json<{ quote: { id: string; totalCents: number; validUntil: string } }>().quote;
}

export const decisionBody = (extra: object = {}) => ({ decision: "aprovado", confirmedByName: "Maria Teste", ...extra });

// --- Fase 4 -----------------------------------------------------------------

export const goodRepair = (extra: object = {}) => ({ procedure: "Troca de bateria e limpeza dos contatos", outcome: "concluido", ...extra });

export const passingTests = () => ({
  items: [{ item: "Carga", result: "aprovado" }, { item: "Tela", result: "aprovado" }, { item: "Câmera", result: "nao_aplicavel" }],
});

/** OS com orçamento aprovado em pessoa: chega em EM_REPARO. */
export async function orderInRepair(env: TestEnv, owner: Session) {
  const order = await orderInDiagnosis(env, owner);
  await diagnose(env, order.techSession, order.orderId);
  const sent = await sendQuote(env, owner, order.orderId);
  const res = await call(env, owner, "POST", `/quotes/${sent.id}/decision`, decisionBody());
  if (res.statusCode !== 201) throw new Error(`aprovação falhou: ${res.statusCode} ${res.body}`);
  return { ...order, sent };
}

export async function repairAndStartTests(env: TestEnv, session: Session, orderId: string) {
  const repaired = await call(env, session, "POST", `/work-orders/${orderId}/repairs`, goodRepair());
  if (repaired.statusCode !== 201) throw new Error(`reparo falhou: ${repaired.statusCode} ${repaired.body}`);
  const started = await transition(env, session, orderId, "iniciar_testes");
  if (started.statusCode !== 200) throw new Error(`iniciar_testes falhou: ${started.statusCode} ${started.body}`);
}

/** Do reparo até PRONTA_RETIRADA, com testes aprovados. */
export async function orderReadyForPickup(env: TestEnv, owner: Session) {
  const order = await orderInRepair(env, owner);
  await repairAndStartTests(env, order.techSession, order.orderId);
  const tests = await call(env, order.techSession, "POST", `/work-orders/${order.orderId}/test-checks`, passingTests());
  if (tests.statusCode !== 201) throw new Error(`testes falharam: ${tests.statusCode} ${tests.body}`);
  const approved = await transition(env, order.techSession, order.orderId, "aprovar_testes");
  if (approved.statusCode !== 200) throw new Error(`aprovar_testes falhou: ${approved.statusCode} ${approved.body}`);
  return order;
}

export const deliveryBody = (version: number, extra: object = {}) => ({
  expectedVersion: version, pickedUpByName: "Maria Teste", confirmationMethod: "comprovante_apresentado", itemsReturned: ["carregador"], ...extra,
});

export async function deliver(env: TestEnv, session: Session, orderId: string, extra: object = {}) {
  const { version } = await orderDetail(env, session, orderId);
  return call(env, session, "POST", `/work-orders/${orderId}/delivery`, deliveryBody(version, extra));
}

// --- Fase 5 -----------------------------------------------------------------

/** Gera o link do consumidor e devolve o token (que só existe nesta resposta). */
export async function portalLink(env: TestEnv, session: Session, orderId: string) {
  const res = await call(env, session, "POST", `/work-orders/${orderId}/portal-link`, {});
  if (res.statusCode !== 201) throw new Error(`link falhou: ${res.statusCode} ${res.body}`);
  return res.json<{ token: string; path: string; expiresAt: string }>();
}

/** Leitura pública do portal: o token vai num cabeçalho, nunca na URL. */
export function portalRead(env: TestEnv, token?: string) {
  return env.app.inject({ method: "GET", url: "/api/v1/portal/order", headers: token === undefined ? {} : { "x-portal-token": token } });
}
