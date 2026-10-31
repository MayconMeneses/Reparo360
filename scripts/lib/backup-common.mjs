// Funções comuns dos scripts de backup. O banco é acessado pelo contêiner do PostgreSQL (docker compose),
// como superusuário, só para dump/consulta; nenhum dado sai do computador.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../..", import.meta.url));

/** Lê um arquivo .env simples (CHAVE=valor). Não imprime nada. */
export function loadEnv(file = join(root, ".env")) {
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) values[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return values;
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[++i];
  }
  return out;
}

export const compose = (args, stdio = ["ignore", "pipe", "pipe"]) =>
  spawnSync("docker", ["compose", "exec", "-T", "postgres", ...args], { cwd: root, stdio, encoding: "utf8" });

export function psql(db, sql) {
  const res = compose(["psql", "-U", "postgres", "-d", db, "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", sql]);
  if (res.status !== 0) throw new Error(`psql falhou em ${db}: ${res.stderr}`);
  return res.stdout.trim();
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
  });
}

/** Lista arquivos de uma pasta, recursivamente, com caminho relativo em barras normais. */
export function listFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push({ key: relative(dir, full).split("\\").join("/"), path: full, bytes: statSync(full).size });
    }
  };
  if (existsSync(dir)) walk(dir);
  return found;
}

export function tableCounts(db) {
  const tables = psql(db, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1").split("\n").filter(Boolean);
  return Object.fromEntries(tables.map((t) => [t, Number(psql(db, `SELECT count(*) FROM "${t}"`))]));
}

export function attachmentRows(db) {
  const text = psql(db, "SELECT storage_key, size_bytes, sha256 FROM attachments ORDER BY storage_key");
  return text ? text.split("\n").map((l) => { const [key, bytes, sha] = l.split("|"); return { key, bytes: Number(bytes), sha }; }) : [];
}
