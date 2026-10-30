// Backup + restauração de verificação do banco de TESTE (dados sintéticos).
// 1) pg_dump -Fc para backups/ (ignorado pelo Git);
// 2) pg_restore em um banco descartável;
// 3) compara contagens por tabela, políticas RLS e flags de RLS;
// 4) apaga o banco descartável.
// Limites desta etapa: sem criptografia, sem cópia externa, sem retenção. Ver relatório da fase.
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = "reparo360_test";
const RESTORED = "reparo360_restore_check";
const compose = (args, stdio = ["ignore", "pipe", "pipe"]) =>
  spawnSync("docker", ["compose", "exec", "-T", "postgres", ...args], { cwd: root, stdio, encoding: "utf8" });

function psql(db, sql) {
  const res = compose(["psql", "-U", "postgres", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  if (res.status !== 0) throw new Error(`psql falhou em ${db}: ${res.stderr}`);
  return res.stdout.trim();
}

function snapshot(db) {
  const tables = psql(db, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1").split("\n").filter(Boolean);
  const counts = Object.fromEntries(tables.map((t) => [t, Number(psql(db, `SELECT count(*) FROM "${t}"`))]));
  const policies = psql(db, "SELECT count(*) FROM pg_policies WHERE schemaname='public'");
  const rls = psql(db, "SELECT string_agg(relname||':'||relrowsecurity||':'||relforcerowsecurity, ',' ORDER BY relname) FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace");
  return { counts, policies, rls };
}

const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const dumpDir = join(root, "backups");
mkdirSync(dumpDir, { recursive: true });
const dumpFile = join(dumpDir, `${SOURCE}-${stamp}.dump`);

const before = snapshot(SOURCE);

const out = openSync(dumpFile, "w");
const dump = compose(["pg_dump", "-U", "postgres", "-Fc", SOURCE], ["ignore", out, "pipe"]);
closeSync(out);
if (dump.status !== 0) throw new Error(`pg_dump falhou: ${dump.stderr}`);
const size = statSync(dumpFile).size;
if (size === 0) throw new Error("dump vazio");

psql("postgres", `DROP DATABASE IF EXISTS ${RESTORED}`);
psql("postgres", `CREATE DATABASE ${RESTORED}`);
try {
  const input = openSync(dumpFile, "r");
  const restore = compose(["pg_restore", "-U", "postgres", "-d", RESTORED, "--no-owner", "--exit-on-error"], [input, "pipe", "pipe"]);
  closeSync(input);
  if (restore.status !== 0) throw new Error(`pg_restore falhou: ${restore.stderr}`);

  const after = snapshot(RESTORED);
  const same = JSON.stringify(before) === JSON.stringify(after);
  console.log(`dump: ${dumpFile} (${size} bytes)`);
  console.log("antes :", JSON.stringify(before));
  console.log("depois:", JSON.stringify(after));
  console.log(same ? "RESULTADO: PASS (contagens, políticas e flags de RLS idênticas)" : "RESULTADO: FAIL (divergência após restaurar)");
  process.exitCode = same ? 0 : 1;
} finally {
  psql("postgres", `DROP DATABASE IF EXISTS ${RESTORED}`);
}
