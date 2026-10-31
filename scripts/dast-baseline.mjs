/* global fetch, setTimeout */
// DAST de linha de base (OWASP ZAP): rastreia o sistema e analisa as respostas de forma PASSIVA, sem atacar.
//   node scripts/dast-baseline.mjs
// Sobe a API compilada + a interface (apps/api/dist e apps/web/dist) apontando para o banco de TESTE, só neste computador,
// e roda o ZAP em Docker contra ela. Não é varredura autenticada nem ativa: vê cabeçalhos, cookies, páginas e erros
// que um visitante anônimo alcança. Resultado: scratch/zap-report.json e um resumo na tela.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv, root } from "./lib/backup-common.mjs";

const PORT = 3997;
const env = loadEnv();
if (!env.TEST_DATABASE_URL) { console.error("TEST_DATABASE_URL não definida no .env"); process.exit(2); }
const out = mkdtempSync(join(tmpdir(), "r360-zap-"));
mkdirSync(out, { recursive: true });

// 0.0.0.0 só para o contêiner do ZAP alcançar; o banco de teste é descartável e não há dados reais.
const serverEnv = {
  ...process.env, ...env, DATABASE_URL: env.TEST_DATABASE_URL, PORT: String(PORT), HOST: "0.0.0.0", LOG_LEVEL: "silent",
  ALLOW_PUBLIC_ONBOARDING: "false", STORAGE_DIR: join(out, "anexos"), WEB_DIST: join(root, "apps", "web", "dist").replaceAll("\\", "/"),
  MASTER_ENC_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", LOGIN_RATE_LIMIT_MAX: "1000",
};
const server = spawn("node", ["apps/api/dist/server.js"], { cwd: root, env: serverEnv, stdio: "ignore" });
process.on("exit", () => { try { server.kill(); } catch { /* já encerrou */ } });

async function until(fn, ms) { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* tenta de novo */ } await new Promise((r) => setTimeout(r, 300)); } return false; }
if (!(await until(async () => (await fetch(`http://127.0.0.1:${PORT}/health`)).ok, 20000))) { console.error("o sistema não subiu (rode pnpm build antes)"); process.exit(2); }

const zap = spawnSync("docker", [
  "run", "--rm", "-v", `${out}:/zap/wrk:rw`, "ghcr.io/zaproxy/zaproxy:stable",
  "zap-baseline.py", "-t", `http://host.docker.internal:${PORT}`, "-J", "zap-report.json", "-m", "3", "-I",
], { encoding: "utf8", timeout: 20 * 60 * 1000 });
server.kill();

const tail = (zap.stdout ?? "").split("\n").filter((l) => /^(PASS|WARN-NEW|FAIL-NEW|WARN-INPROG|FAIL-INPROG|FAIL-|WARN-|INFO|SKIP|IGNORE)|FAIL-NEW:|WARN-NEW:|URLs/.test(l));
console.log(tail.join("\n"));
try {
  const report = JSON.parse(readFileSync(join(out, "zap-report.json"), "utf8"));
  console.log(`\nZAP ${report["@version"]}; sites: ${report.site.map((s) => s["@name"]).join(", ")}`);
  for (const site of report.site) {
    for (const alert of site.alerts) console.log(`  [risco ${alert.riskdesc}] ${alert.name}  (${alert.instances.length} ocorrência(s))`);
  }
  console.log(`\nrelatório completo: ${join(out, "zap-report.json")}`);
} catch (error) {
  console.error("não consegui ler o relatório do ZAP:", error.message);
  console.error((zap.stderr ?? "").slice(-1500));
  process.exitCode = 1;
}
