// Verifica o limite de linhas por arquivo (RNF-007). Arquivos acima do limite só
// passam se estiverem justificados em scripts/file-size-allowlist.json.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const LIMIT = 300;
const root = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "meta", ".git", "backups"]);
const EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);

const allowPath = join(root, "scripts", "file-size-allowlist.json");
const allow = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, "utf8")) : {};

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name) && name !== "migrations") yield* walk(full);
    } else if (EXTENSIONS.has(name.slice(name.lastIndexOf(".")))) {
      yield full;
    }
  }
}

const offenders = [];
let checked = 0;
for (const top of ["apps", "packages", "scripts"]) {
  const dir = join(root, top);
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    checked += 1;
    const lines = readFileSync(file, "utf8").split("\n").length;
    const rel = relative(root, file).replaceAll("\\", "/");
    if (lines > LIMIT) offenders.push({ rel, lines, reason: allow[rel] });
  }
}

const unjustified = offenders.filter((o) => !o.reason);
for (const o of offenders) console.log(`${o.reason ? "justificado" : "ACIMA DO LIMITE"}  ${o.lines} linhas  ${o.rel}${o.reason ? `  (${o.reason})` : ""}`);
console.log(`${checked} arquivos verificados; limite ${LIMIT}; ${unjustified.length} sem justificativa.`);
process.exit(unjustified.length === 0 ? 0 : 1);
