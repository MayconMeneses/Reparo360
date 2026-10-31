import { randomUUID } from "node:crypto";
import { hashPassword } from "../src/security/password.js";
import { sealSecret } from "../src/modules/master/secret-box.js";
import { newTotpSecret, stepAt, totpCode } from "../src/modules/master/totp.js";
import { COOKIE_NAME, type TestEnv } from "./helpers.js";

export const MASTER_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
export const MASTER_PASSWORD = "senha-master-sintetica-123";
export const MASTER_COOKIE = "__Host-r360_master";

export interface TestMaster {
  id: string;
  email: string;
  secret: Buffer;
}

/** Cria o administrador direto no banco, como faz o script de linha de comando (não existe rota para isso). */
export async function seedMaster(env: TestEnv, label = "master"): Promise<TestMaster> {
  const secret = newTotpSecret();
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@plataforma.invalid`;
  await env.migrator.query(
    "INSERT INTO platform_admins (id, email, name, password_hash, totp_secret_enc) VALUES ($1, $2, $3, $4, $5)",
    [id, email, "Operador Teste", await hashPassword(MASTER_PASSWORD), sealSecret(Buffer.from(MASTER_KEY_HEX, "hex"), secret)],
  );
  return { id, email, secret };
}

export const codeFor = (master: TestMaster, at: Date, stepOffset = 0) => totpCode(master.secret, stepAt(at) + stepOffset);

export function postJson(env: TestEnv, url: string, payload: object, cookie?: string, csrf?: string) {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  return env.app.inject({ method: "POST", url: `/api/v1${url}`, headers, payload });
}

export function getWith(env: TestEnv, url: string, cookie?: string) {
  return env.app.inject({ method: "GET", url: `/api/v1${url}`, headers: cookie ? { cookie } : {} });
}

export interface MasterSession {
  cookie: string;
  csrf: string;
}

export async function passwordStep(env: TestEnv, master: TestMaster, password = MASTER_PASSWORD) {
  return postJson(env, "/master/auth/login", { email: master.email, password });
}

/** Login completo em duas etapas, com o código do instante informado. */
export async function masterLogin(env: TestEnv, master: TestMaster, at: Date): Promise<MasterSession> {
  const first = await passwordStep(env, master);
  if (first.statusCode !== 200) throw new Error(`senha falhou: ${first.statusCode} ${first.body}`);
  const second = await postJson(env, "/master/auth/mfa", { challenge: first.json().challenge, code: codeFor(master, at) });
  if (second.statusCode !== 200) throw new Error(`mfa falhou: ${second.statusCode} ${second.body}`);
  const cookie = second.cookies.find((c) => c.name === MASTER_COOKIE);
  if (!cookie) throw new Error("cookie do master ausente");
  return { cookie: `${MASTER_COOKIE}=${cookie.value}`, csrf: second.json().csrfToken };
}

export const asTenantCookie = (session: { cookie: string }) => session.cookie.replace(/^[^=]+/, COOKIE_NAME);
