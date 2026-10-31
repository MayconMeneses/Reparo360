// Prova que um backup completo é restaurável, SEM tocar no banco real:
// confere o SHA-256 do dump e dos anexos contra o manifesto, restaura o dump num banco descartável e compara
// contagens por tabela e a presença de cada anexo registrado. Backup cifrado: defina BACKUP_PASSPHRASE.
//   node scripts/restore-verify.mjs <pasta-do-backup>
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { attachmentRows, compose, listFiles, psql, sha256File, tableCounts } from "./lib/backup-common.mjs";
import { decryptFile, deriveKey, verifierMatches } from "./lib/backup-crypto.mjs";

const folder = process.argv[2] && !process.argv[2].startsWith("--") ? resolve(process.argv[2]) : null;
if (!folder || !existsSync(join(folder, "manifesto.json"))) {
  console.error("Uso: node scripts/restore-verify.mjs <pasta-do-backup> (precisa conter manifesto.json)");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(folder, "manifesto.json"), "utf8"));
const SCRATCH = "reparo360_restore_verify";
const problems = [];
let key = null;

if (manifest.encrypted) {
  const passphrase = process.env.BACKUP_PASSPHRASE ?? "";
  if (!passphrase) {
    console.error("Este backup é cifrado: defina BACKUP_PASSPHRASE no ambiente.");
    process.exit(2);
  }
  key = deriveKey(passphrase, Buffer.from(manifest.kdf.saltHex, "hex"), manifest.kdf);
  if (!verifierMatches(key, manifest.verifier)) {
    console.log("PROBLEMA: senha do backup incorreta");
    console.log("RESULTADO: FAIL");
    process.exit(1);
  }
}

// Área temporária só para os arquivos decifrados; apagada no fim.
const temp = manifest.encrypted ? mkdtempSync(join(tmpdir(), "r360-verify-")) : null;

/** Devolve o caminho do arquivo em claro (decifra para a área temporária quando o backup é cifrado). */
async function plain(relative, name) {
  if (!manifest.encrypted) return join(folder, relative);
  const target = join(temp, name);
  mkdirSync(dirname(target), { recursive: true });
  try {
    await decryptFile(key, join(folder, `${relative}.enc`), target);
  } catch {
    return null;
  }
  return target;
}

try {
  const dumpFile = manifest.encrypted ? manifest.dump.file.replace(/\.enc$/, "") : manifest.dump.file;
  const dumpPath = await plain(dumpFile, "banco.dump");
  if (!dumpPath || !existsSync(dumpPath)) problems.push("o dump não pôde ser lido (ausente, alterado ou senha incorreta)");
  else if ((await sha256File(dumpPath)) !== manifest.dump.sha256) problems.push("o dump foi alterado desde o backup (SHA-256 diferente)");

  const present = new Set(listFiles(join(folder, "anexos")).map((f) => (manifest.encrypted ? f.key.replace(/\.enc$/, "") : f.key)));
  for (const file of manifest.files) {
    if (!present.has(file.key)) { problems.push(`anexo ausente: ${file.key}`); continue; }
    const path = await plain(join("anexos", file.key), join("anexos", file.key));
    if (!path || !existsSync(path)) problems.push(`anexo alterado: ${file.key}`);
    else if ((await sha256File(path)) !== file.sha256) problems.push(`anexo alterado: ${file.key}`);
  }

  if (problems.length === 0) {
    psql("postgres", `DROP DATABASE IF EXISTS ${SCRATCH}`);
    psql("postgres", `CREATE DATABASE ${SCRATCH}`);
    try {
      const input = openSync(dumpPath, "r");
      const restore = compose(["pg_restore", "-U", "postgres", "-d", SCRATCH, "--no-owner", "--exit-on-error"], [input, "pipe", "pipe"]);
      closeSync(input);
      if (restore.status !== 0) problems.push(`pg_restore falhou: ${restore.stderr.slice(0, 300)}`);
      else {
        const counts = tableCounts(SCRATCH);
        for (const [table, n] of Object.entries(manifest.tableCounts)) if (counts[table] !== n) problems.push(`contagem diferente em ${table}: backup ${n}, restaurado ${counts[table]}`);
        for (const row of attachmentRows(SCRATCH)) if (!present.has(row.key)) problems.push(`anexo do banco restaurado sem arquivo: ${row.key}`);
      }
    } finally {
      psql("postgres", `DROP DATABASE IF EXISTS ${SCRATCH}`);
    }
  }
} finally {
  if (temp) rmSync(temp, { recursive: true, force: true });
}

console.log(`backup: ${folder}`);
console.log(`cifrado: ${manifest.encrypted ? "sim" : "não"} | restaurado em banco descartável: ${problems.length === 0 ? "sim" : "não concluído"} | anexos conferidos: ${manifest.files.length}`);
for (const p of problems) console.log(`PROBLEMA: ${p}`);
console.log(problems.length === 0 ? "RESULTADO: PASS (banco restaura, contagens iguais, anexos íntegros)" : "RESULTADO: FAIL");
process.exitCode = problems.length === 0 ? 0 : 1;
