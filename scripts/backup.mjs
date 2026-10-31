// Backup completo: banco (pg_dump) + arquivos de anexos + manifesto com SHA-256, e conferência na hora.
//   pnpm backup                         (usa o .env: banco reparo360_dev e STORAGE_DIR)
//   node scripts/backup.mjs --db reparo360_test --storage <pasta> --out <pasta de backups>
// Limites: o backup NÃO é criptografado (guarde em disco criptografado), fica no mesmo computador até você
// copiá-lo para outro lugar, e a restauração é do banco INTEIRO (não existe restauração de uma empresa só).
import { closeSync, cpSync, mkdirSync, openSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { attachmentRows, compose, listFiles, loadEnv, parseArgs, root, sha256File, tableCounts } from "./lib/backup-common.mjs";

const args = parseArgs(process.argv.slice(2));
const env = loadEnv();
const dbName = args.db ?? /\/([^/?]+)(\?|$)/.exec(env.MIGRATION_DATABASE_URL ?? "")?.[1];
const storage = args.storage ?? env.STORAGE_DIR;
if (!dbName || !storage) {
  console.error("Defina o banco e a pasta de anexos (.env: MIGRATION_DATABASE_URL e STORAGE_DIR) ou use --db e --storage.");
  process.exit(2);
}

const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const dir = resolve(args.out ?? join(root, "backups"), `completo-${dbName}-${stamp}`);
mkdirSync(join(dir, "anexos"), { recursive: true });

// 1) Banco
const dumpPath = join(dir, "banco.dump");
const out = openSync(dumpPath, "w");
const dump = compose(["pg_dump", "-U", "postgres", "-Fc", dbName], ["ignore", out, "pipe"]);
closeSync(out);
if (dump.status !== 0) throw new Error(`pg_dump falhou: ${dump.stderr}`);
const dumpBytes = statSync(dumpPath).size;
if (dumpBytes === 0) throw new Error("dump vazio");

// 2) Anexos (cópia; nunca sobrescreve)
const source = listFiles(resolve(storage));
cpSync(resolve(storage), join(dir, "anexos"), { recursive: true, errorOnExist: true, force: false });

// 3) Conferência: todo anexo registrado no banco (inclusive excluído logicamente) precisa estar na cópia, com o tamanho e o SHA-256 gravados.
const copied = new Map(listFiles(join(dir, "anexos")).map((f) => [f.key, f]));
const rows = attachmentRows(dbName);
const problems = [];
const files = [];
for (const row of rows) {
  const file = copied.get(row.key);
  if (!file) { problems.push(`ausente na cópia: ${row.key}`); continue; }
  const sha = await sha256File(file.path);
  if (file.bytes !== row.bytes) problems.push(`tamanho diferente: ${row.key} (banco ${row.bytes}, arquivo ${file.bytes})`);
  if (sha !== row.sha) problems.push(`SHA-256 diferente: ${row.key}`);
  files.push({ key: row.key, bytes: file.bytes, sha256: sha });
}
const referenced = new Set(rows.map((r) => r.key));
const orphans = [...copied.keys()].filter((key) => !referenced.has(key));

const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  database: dbName,
  dump: { file: "banco.dump", bytes: dumpBytes, sha256: await sha256File(dumpPath) },
  tableCounts: tableCounts(dbName),
  attachments: { rows: rows.length, filesInStorage: source.length, orphans },
  files,
  problems,
};
writeFileSync(join(dir, "manifesto.json"), JSON.stringify(manifest, null, 2));

console.log(`backup: ${dir}`);
console.log(`banco: ${dumpBytes} bytes | anexos no banco: ${rows.length} | arquivos na pasta: ${source.length} | sem registro (órfãos): ${orphans.length}`);
if (orphans.length > 0) console.log(`aviso: ${orphans.length} arquivo(s) sem registro no banco (copiados mesmo assim).`);
for (const p of problems) console.log(`PROBLEMA: ${p}`);
console.log(problems.length === 0 ? "RESULTADO: PASS (todo anexo registrado está na cópia com tamanho e SHA-256 corretos)" : "RESULTADO: FAIL");
process.exitCode = problems.length === 0 ? 0 : 1;
