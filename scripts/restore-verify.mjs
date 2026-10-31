// Prova que um backup completo é restaurável, SEM tocar no banco real:
// confere o SHA-256 do dump e dos anexos contra o manifesto, restaura o dump num banco descartável e compara
// contagens por tabela e a presença de cada anexo registrado.
//   node scripts/restore-verify.mjs <pasta-do-backup>
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { attachmentRows, compose, listFiles, parseArgs, psql, sha256File, tableCounts } from "./lib/backup-common.mjs";

const folder = process.argv[2] && !process.argv[2].startsWith("--") ? resolve(process.argv[2]) : null;
if (!folder || !existsSync(join(folder, "manifesto.json"))) {
  console.error("Uso: node scripts/restore-verify.mjs <pasta-do-backup> (precisa conter manifesto.json)");
  process.exit(2);
}
parseArgs(process.argv.slice(3));
const manifest = JSON.parse(readFileSync(join(folder, "manifesto.json"), "utf8"));
const SCRATCH = "reparo360_restore_verify";
const problems = [];

if ((await sha256File(join(folder, manifest.dump.file))) !== manifest.dump.sha256) problems.push("o dump foi alterado desde o backup (SHA-256 diferente)");
const stored = new Map(listFiles(join(folder, "anexos")).map((f) => [f.key, f]));
for (const file of manifest.files) {
  const found = stored.get(file.key);
  if (!found) problems.push(`anexo ausente: ${file.key}`);
  else if ((await sha256File(found.path)) !== file.sha256) problems.push(`anexo alterado: ${file.key}`);
}

if (problems.length === 0) {
  psql("postgres", `DROP DATABASE IF EXISTS ${SCRATCH}`);
  psql("postgres", `CREATE DATABASE ${SCRATCH}`);
  try {
    const input = openSync(join(folder, manifest.dump.file), "r");
    const restore = compose(["pg_restore", "-U", "postgres", "-d", SCRATCH, "--no-owner", "--exit-on-error"], [input, "pipe", "pipe"]);
    closeSync(input);
    if (restore.status !== 0) problems.push(`pg_restore falhou: ${restore.stderr.slice(0, 300)}`);
    else {
      const counts = tableCounts(SCRATCH);
      for (const [table, n] of Object.entries(manifest.tableCounts)) if (counts[table] !== n) problems.push(`contagem diferente em ${table}: backup ${n}, restaurado ${counts[table]}`);
      for (const row of attachmentRows(SCRATCH)) if (!stored.has(row.key)) problems.push(`anexo do banco restaurado sem arquivo: ${row.key}`);
    }
  } finally {
    psql("postgres", `DROP DATABASE IF EXISTS ${SCRATCH}`);
  }
}

console.log(`backup: ${folder}`);
console.log(`restaurado em banco descartável: ${problems.length === 0 ? "sim" : "não concluído"} | anexos conferidos: ${manifest.files.length}`);
for (const p of problems) console.log(`PROBLEMA: ${p}`);
console.log(problems.length === 0 ? "RESULTADO: PASS (banco restaura, contagens iguais, anexos íntegros)" : "RESULTADO: FAIL");
process.exitCode = problems.length === 0 ? 0 : 1;
