// Servidor dos testes de navegador (E2E). Sobe a API de verdade + a interface compilada contra o banco de TESTE,
// com um "e-mail" que grava em arquivo (o navegador de teste lê o link de lá). Nada disto existe no sistema instalado.
//   pnpm --filter @reparo360/api e2e   (compila a interface antes: pnpm build)
import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, runMigrations } from "@reparo360/database";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { Mailer } from "../src/mail/mailer.js";
import { E2E } from "./constants.js";

const root = fileURLToPath(new URL("../../..", import.meta.url));
process.loadEnvFile(join(root, ".env"));
const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não definida (.env)`);
  return value;
};

await runMigrations(need("TEST_MIGRATION_DATABASE_URL"));
mkdirSync(E2E.outDir, { recursive: true });

const config = loadConfig({
  DATABASE_URL: need("TEST_DATABASE_URL"),
  STORAGE_DIR: mkdtempSync(join(tmpdir(), "r360-e2e-")),
  HOST: "127.0.0.1",
  PORT: String(E2E.port),
  COOKIE_SECURE: "true", // http://localhost conta como contexto seguro nos navegadores modernos
  ALLOW_PUBLIC_ONBOARDING: "true",
  LOG_LEVEL: "silent",
  LOGIN_RATE_LIMIT_MAX: "1000",
  LOGIN_ACCOUNT_MAX_FAILURES: "1000",
  MASTER_ENC_KEY: E2E.masterKeyHex,
  VERIFICATION_SECRET: E2E.verificationSecret,
  PUBLIC_URL: E2E.baseUrl,
  WEB_DIST: join(root, "apps", "web", "dist").replaceAll("\\", "/"),
});

const mailer: Mailer = {
  enabled: true,
  async send(mail) {
    appendFileSync(E2E.outbox, `${JSON.stringify(mail)}\n`);
  },
};

const pool = createPool(config.databaseUrl, 5);
const app = await buildApp({ config, pool, mailer });
await app.listen({ host: config.host, port: config.port });
