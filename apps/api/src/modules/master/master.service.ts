import { withContext } from "@reparo360/database";
import { sql } from "drizzle-orm";
import { recordAudit } from "../../audit.js";
import { HttpError } from "../../http-error.js";
import { verifyPassword } from "../../security/password.js";
import { accountKey } from "../../security/throttle.js";
import { randomBytes } from "node:crypto";
import { hashToken, newToken } from "../../security/tokens.js";
import type { AppServices } from "../../services.js";
import { provisionTenant, type RequestMeta } from "../identity/auth.service.js";
import { openSecret } from "./secret-box.js";
import { verifyTotp } from "./totp.js";

export interface MasterContext {
  sessionHash: string;
  adminId: string;
  email: string;
  name: string;
  csrfToken: string;
  lastAuthAt: Date;
}

const invalidCredentials = () => new HttpError(401, "CREDENCIAIS_INVALIDAS", "E-mail ou senha incorretos.");
const invalidCode = () => new HttpError(401, "CODIGO_MFA_INVALIDO", "Código inválido ou expirado. Entre novamente.");
const tooMany = () => new HttpError(429, "MUITAS_TENTATIVAS", "Muitas tentativas. Aguarde e tente novamente.");
const encKey = (deps: AppServices): Buffer => {
  if (!deps.config.masterEncKey) throw new Error("MASTER_ENC_KEY ausente");
  return deps.config.masterEncKey;
};

/** Auditoria sem empresa: login do Master, bem ou mal sucedido. Nunca grava senha nem código. */
const audit = (deps: AppServices, meta: RequestMeta, action: string, outcome: "ok" | "negado", adminId?: string) =>
  withContext(deps.pool, {}, (db) =>
    recordAudit(db, { action, outcome, actorUserId: adminId, correlationId: meta.correlationId, ip: meta.ip }));

/** Passo 1: senha. Não cria sessão: devolve um desafio de 5 minutos que só o código MFA completa. */
export async function masterPasswordStep(deps: AppServices, input: { email: string; password: string }, meta: RequestMeta) {
  const key = `master|${accountKey(meta.ip, input.email)}`;
  if (deps.loginThrottle.isBlocked(key)) throw tooMany();
  const lookup = await deps.pool.query<{ id: string; password_hash: string; status: string }>("SELECT * FROM master_login_lookup($1)", [input.email]);
  const found = lookup.rows[0];
  const ok = await verifyPassword(found?.password_hash ?? null, input.password);
  if (!found || !ok || found.status !== "ativo") {
    deps.loginThrottle.fail(key);
    await audit(deps, meta, "master_login_password", "negado");
    throw invalidCredentials();
  }
  const token = newToken();
  const expires = new Date(deps.clock().getTime() + deps.config.masterChallengeTtlMs);
  await deps.pool.query("SELECT master_create_challenge($1, $2, $3, $4)", [found.id, hashToken(token), expires, meta.ip]);
  await audit(deps, meta, "master_login_password", "ok", found.id);
  return { challenge: token, expiresInSeconds: Math.round(deps.config.masterChallengeTtlMs / 1000) };
}

type MfaOutcome =
  | { kind: "fail" }
  | { kind: "ok"; token: string; csrfToken: string; expiresAt: Date; adminId: string };

/** Passo 2: código MFA. Só aqui a sessão nasce. O contador de erros confirma porque o resultado volta, não é lançado. */
export async function masterMfaStep(deps: AppServices, input: { challenge: string; code: string }, meta: RequestMeta) {
  const key = `master-mfa|${meta.ip}`;
  if (deps.loginThrottle.isBlocked(key)) throw tooMany();
  const now = deps.clock();
  const outcome = await withContext<MfaOutcome>(deps.pool, {}, async (db) => {
    const found = await db.execute<{ challenge_id: string; admin_id: string; attempts: number; totp_secret_enc: string; totp_last_step: string }>(
      sql`SELECT * FROM master_challenge_get(${hashToken(input.challenge)}, ${now.toISOString()}::timestamptz)`);
    const row = found.rows[0];
    if (!row || row.attempts >= deps.config.masterChallengeMaxAttempts) return { kind: "fail" };
    const step = verifyTotp(openSecret(encKey(deps), row.totp_secret_enc), input.code, now, Number(row.totp_last_step));
    if (step === null) {
      await db.execute(sql`SELECT master_challenge_fail(${row.challenge_id}::uuid)`);
      return { kind: "fail" };
    }
    const token = newToken();
    const csrfToken = newToken();
    const expiresAt = new Date(now.getTime() + deps.config.masterSessionTtlMs);
    const done = await db.execute<{ master_challenge_complete: boolean }>(
      sql`SELECT master_challenge_complete(${row.challenge_id}::uuid, ${step}::bigint, ${hashToken(token)}, ${csrfToken}, ${expiresAt.toISOString()}::timestamptz, ${meta.ip}, ${meta.userAgent?.slice(0, 200) ?? null}, ${now.toISOString()}::timestamptz)`);
    if (!done.rows[0]?.master_challenge_complete) return { kind: "fail" };
    return { kind: "ok", token, csrfToken, expiresAt, adminId: row.admin_id };
  });
  if (outcome.kind === "fail") {
    deps.loginThrottle.fail(key);
    await audit(deps, meta, "master_login_mfa", "negado");
    throw invalidCode();
  }
  deps.loginThrottle.reset(key);
  await audit(deps, meta, "master_login_mfa", "ok", outcome.adminId);
  return outcome;
}

/** Sessão do Master pelo hash do cookie. A validade e o administrador ativo são conferidos DENTRO do banco. */
export async function resolveMasterSession(deps: AppServices, token: string | undefined): Promise<MasterContext> {
  if (!token) throw new HttpError(401, "NAO_AUTENTICADO", "Sessão ausente ou expirada.");
  const sessionHash = hashToken(token);
  const now = deps.clock();
  const result = await deps.pool.query<{ admin_id: string; email: string; name: string; csrf_token: string; last_seen_at: Date; last_auth_at: Date }>(
    "SELECT * FROM master_session_get($1, $2)", [sessionHash, now]);
  const row = result.rows[0];
  if (!row || row.last_seen_at.getTime() + deps.config.masterIdleMs <= now.getTime()) {
    throw new HttpError(401, "NAO_AUTENTICADO", "Sessão ausente ou expirada.");
  }
  if (now.getTime() - row.last_seen_at.getTime() > 60_000) await deps.pool.query("SELECT master_session_touch($1, $2)", [sessionHash, now]);
  return { sessionHash, adminId: row.admin_id, email: row.email, name: row.name, csrfToken: row.csrf_token, lastAuthAt: row.last_auth_at };
}

export async function masterLogout(deps: AppServices, auth: MasterContext, meta: RequestMeta): Promise<void> {
  await deps.pool.query("SELECT master_session_revoke($1, $2)", [auth.sessionHash, deps.clock()]);
  await audit(deps, meta, "master_logout", "ok", auth.adminId);
}

/** Reautenticação: um NOVO código (passo maior que o último aceito). Abre a janela curta das ações sensíveis. */
export async function masterReauth(deps: AppServices, auth: MasterContext, code: string, meta: RequestMeta): Promise<void> {
  const key = `master-reauth|${auth.adminId}`;
  if (deps.loginThrottle.isBlocked(key)) throw tooMany();
  const now = deps.clock();
  const material = await deps.pool.query<{ totp_secret_enc: string; totp_last_step: string }>("SELECT * FROM master_totp_material($1, $2)", [auth.sessionHash, now]);
  const row = material.rows[0];
  const step = row ? verifyTotp(openSecret(encKey(deps), row.totp_secret_enc), code, now, Number(row.totp_last_step)) : null;
  const accepted = step !== null
    && (await deps.pool.query<{ master_reauth: boolean }>("SELECT master_reauth($1, $2, $3)", [auth.sessionHash, step, now])).rows[0]?.master_reauth === true;
  await audit(deps, meta, "master_reauth", accepted ? "ok" : "negado", auth.adminId);
  if (!accepted) {
    deps.loginThrottle.fail(key);
    throw invalidCode();
  }
  deps.loginThrottle.reset(key);
}

export async function listTenants(deps: AppServices, auth: MasterContext) {
  const result = await deps.pool.query<{ t_id: string; t_name: string; t_trade_name: string | null; t_status: string; t_created_at: Date; t_members: string; t_work_orders: string }>(
    "SELECT * FROM master_list_tenants($1, $2)", [auth.sessionHash, deps.clock()]);
  return result.rows.map((r) => ({
    id: r.t_id, name: r.t_name, tradeName: r.t_trade_name, status: r.t_status, createdAt: r.t_created_at,
    activeMembers: Number(r.t_members), workOrders: Number(r.t_work_orders),
  }));
}

const recentAuthRequired = (deps: AppServices, auth: MasterContext) => {
  if (deps.clock().getTime() - auth.lastAuthAt.getTime() > deps.config.masterRecentAuthMs) {
    throw new HttpError(403, "REAUTENTICACAO_NECESSARIA", "Confirme com um novo código do autenticador para continuar.");
  }
};

export interface NewTenantInput {
  tenantName: string;
  tradeName?: string;
  phone?: string;
  ownerName: string;
  ownerEmail: string;
}

/**
 * Cria a assistência e o primeiro proprietário. O Master NÃO escolhe a senha: o servidor gera uma temporária,
 * mostrada uma única vez, e a conta fica travada até o proprietário definir a própria (sem isso o Master
 * poderia entrar como ele). A senha nunca vai para log nem auditoria.
 */
export async function createTenant(deps: AppServices, auth: MasterContext, input: NewTenantInput, meta: RequestMeta) {
  recentAuthRequired(deps, auth);
  const temporaryPassword = randomBytes(15).toString("base64url");
  const { tenantId, userId } = await provisionTenant(
    deps, { ...input, ownerPassword: temporaryPassword, mustChangePassword: true }, meta);
  await withContext(deps.pool, { tenantId }, (db) =>
    recordAudit(db, {
      tenantId, actorUserId: auth.adminId, action: "master_tenant_created", targetType: "tenant", targetId: tenantId,
      outcome: "ok", correlationId: meta.correlationId, ip: meta.ip,
    }));
  return { tenantId, ownerId: userId, ownerEmail: input.ownerEmail, temporaryPassword };
}

/** Suspender/reativar: exige código MFA recente e um motivo, e fica na trilha da própria empresa. */
export async function setTenantStatus(
  deps: AppServices, auth: MasterContext, tenantId: string, input: { status: "ativa" | "suspensa"; reason: string }, meta: RequestMeta,
): Promise<void> {
  recentAuthRequired(deps, auth);
  const result = await deps.pool.query<{ master_set_tenant_status: string }>(
    "SELECT master_set_tenant_status($1, $2, $3, $4, $5, $6, $7)",
    [auth.sessionHash, deps.clock(), tenantId, input.status, input.reason, meta.correlationId, meta.ip]);
  const code = result.rows[0]?.master_set_tenant_status;
  if (code === "nao_encontrada") throw new HttpError(404, "EMPRESA_NAO_ENCONTRADA", "Empresa não encontrada.");
  if (code === "transicao_invalida") throw new HttpError(422, "TRANSICAO_INVALIDA", "Esta mudança de situação não é permitida para a empresa.");
  if (code !== "ok") throw new HttpError(500, "ERRO_INTERNO", "Erro interno.");
}
