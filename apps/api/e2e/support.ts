import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";
import { hashPassword } from "../src/security/password.js";
import { sealSecret } from "../src/modules/master/secret-box.js";
import { newTotpSecret, stepAt, totpCode } from "../src/modules/master/totp.js";
import { E2E } from "./constants.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
process.loadEnvFile(join(root, ".env"));

export const OWNER_PASSWORD = "senha-do-dono-e2e-123";

/** Esvazia o banco de teste e a caixa de saída de e-mail. Cada arquivo de teste começa do zero. */
export async function resetAll(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env["TEST_MIGRATION_DATABASE_URL"], max: 1 });
  try {
    await pool.query("TRUNCATE audit_events, sessions, memberships, users, tenants, platform_sessions, platform_challenges, platform_admins, password_tokens CASCADE");
  } finally {
    await pool.end();
  }
  writeFileSync(E2E.outbox, "");
}

export interface SeededMaster {
  email: string;
  password: string;
  secret: Buffer;
}

/** Cria o administrador Master direto no banco, como o script de linha de comando faz. */
export async function seedMaster(): Promise<SeededMaster> {
  const secret = newTotpSecret();
  const email = `master-${randomUUID().slice(0, 8)}@plataforma.invalid`;
  const password = "senha-master-e2e-123456";
  const pool = new pg.Pool({ connectionString: process.env["TEST_MIGRATION_DATABASE_URL"], max: 1 });
  try {
    await pool.query("INSERT INTO platform_admins (email, name, password_hash, totp_secret_enc) VALUES ($1, 'Operador E2E', $2, $3)",
      [email, await hashPassword(password), sealSecret(Buffer.from(E2E.masterKeyHex, "hex"), secret)]);
  } finally {
    await pool.end();
  }
  return { email, password, secret };
}

/** Código do autenticador do passo atual (+offset). Um código já usado não vale de novo: peça o do passo seguinte. */
export const totpFor = (master: SeededMaster, stepOffset = 0): string => totpCode(master.secret, stepAt(new Date()) + stepOffset);

export function outbox(): Array<{ to: string; subject: string; text: string }> {
  if (!existsSync(E2E.outbox)) return [];
  return readFileSync(E2E.outbox, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { to: string; subject: string; text: string });
}

/** Cria uma assistência pela API pública de cadastro (ligada só neste servidor de teste). */
export async function createTenant(label: string): Promise<{ email: string; password: string; tenantName: string }> {
  const email = `${label}-${randomUUID().slice(0, 8)}@teste.invalid`;
  const tenantName = `Assistência ${label}`;
  const response = await fetch(`${E2E.baseUrl}/api/v1/tenants`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: E2E.baseUrl },
    body: JSON.stringify({ tenantName, ownerName: `Dono ${label}`, ownerEmail: email, ownerPassword: OWNER_PASSWORD }),
  });
  if (response.status !== 201) throw new Error(`cadastro falhou: ${response.status}`);
  return { email, password: OWNER_PASSWORD, tenantName };
}

const lastStep = new WeakMap<SeededMaster, number>();

/**
 * Próximo código do autenticador que o servidor aceita: passo MAIOR que o último usado e dentro da janela de ±1.
 * Se o relógio ainda não chegou lá, espera (cada passo dura 30 s).
 */
export async function nextCode(master: SeededMaster): Promise<string> {
  for (;;) {
    const current = stepAt(new Date());
    const candidate = Math.max((lastStep.get(master) ?? 0) + 1, current - 1);
    if (candidate <= current + 1) {
      lastStep.set(master, candidate);
      return totpCode(master.secret, candidate);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
