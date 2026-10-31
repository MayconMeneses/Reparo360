import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JPEG, loginOk, onboard, PNG, resetData, setupOrder, startTestEnv, upload, type Session, type TestEnv } from "./helpers.js";

// Backup cifrado (AES-256-GCM): nada em claro na pasta, senha errada recusada, adulteração detectada.
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const PASS = "senha-de-backup-sintetica-1";
let env: TestEnv;
let owner: Session;
let backups: string;

beforeAll(async () => {
  env = await startTestEnv();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  backups = mkdtempSync(join(tmpdir(), "r360-backups-enc-"));
  for (const entry of readdirSync(env.storageDir)) rmSync(join(env.storageDir, entry), { recursive: true, force: true });
  await resetData(env.migrator);
  owner = await loginOk(env, (await onboard(env, "backupEnc")).email);
  const { orderId } = await setupOrder(env, owner);
  expect((await upload(env, owner, orderId, "image/jpeg", JPEG)).statusCode).toBe(201);
  expect((await upload(env, owner, orderId, "image/png", PNG)).statusCode).toBe(201);
});

const run = (script: string, args: string[], passphrase?: string) => {
  const childEnv = { ...process.env } as Record<string, string | undefined>;
  delete childEnv["BACKUP_PASSPHRASE"];
  if (passphrase !== undefined) childEnv["BACKUP_PASSPHRASE"] = passphrase;
  const res = spawnSync("node", [join(root, "scripts", script), ...args], { cwd: root, encoding: "utf8", env: childEnv as NodeJS.ProcessEnv });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
};
const backup = (passphrase?: string, ...extra: string[]) =>
  run("backup.mjs", ["--db", "reparo360_test", "--storage", env.storageDir, "--out", backups, ...extra], passphrase);
const folderOf = (out: string) => /backup: (.+)/.exec(out)?.[1]?.trim() ?? "";
const allFiles = (dir: string) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));

describe("backup cifrado", () => {
  it("cifra banco e anexos: nenhum arquivo em claro, e a verificação com a senha certa passa", () => {
    const made = backup(PASS, "--encrypt");
    expect(made.code, made.out).toBe(0);
    expect(made.out).toContain("cifrado: sim");
    const folder = folderOf(made.out);
    const files = allFiles(folder).filter((f) => !f.endsWith("manifesto.json"));
    expect(files.length).toBe(3); // banco + 2 anexos
    for (const file of files) {
      expect(file.endsWith(".enc"), file).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 8).toString()).toBe("R360ENC1");
      expect(bytes.includes(Buffer.from("conteudo sintetico"))).toBe(false); // texto dos anexos de teste
      expect(bytes.subarray(0, 5).toString()).not.toBe("PGDMP"); // cabeçalho do dump em claro
    }
    const manifestText = readFileSync(join(folder, "manifesto.json"), "utf8");
    expect(manifestText).not.toContain(PASS);
    expect(JSON.parse(manifestText)).toMatchObject({ encrypted: true, version: 2 });

    const verified = run("restore-verify.mjs", [folder], PASS);
    expect(verified.code, verified.out).toBe(0);
    expect(verified.out).toContain("cifrado: sim");
    expect(verified.out).toContain("anexos conferidos: 2");
  }, 180_000);

  it("senha errada ou ausente: a verificação recusa, sem tocar em nada", () => {
    const folder = folderOf(backup(PASS, "--encrypt").out);
    const wrong = run("restore-verify.mjs", [folder], "outra-senha-qualquer-12");
    expect(wrong.code).toBe(1);
    expect(wrong.out).toContain("senha do backup incorreta");
    const none = run("restore-verify.mjs", [folder]);
    expect(none.code).toBe(2);
    expect(none.out).toContain("BACKUP_PASSPHRASE");
  }, 180_000);

  it("um byte alterado em qualquer arquivo cifrado é detectado (banco e anexo)", () => {
    const folder = folderOf(backup(PASS, "--encrypt").out);
    const files = allFiles(folder).filter((f) => f.endsWith(".enc"));
    const attachment = files.find((f) => f.includes("anexos"))!;
    const bytes = readFileSync(attachment);
    bytes[bytes.length - 20] = (bytes[bytes.length - 20]! + 1) % 256;
    writeFileSync(attachment, bytes);
    const bad = run("restore-verify.mjs", [folder], PASS);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("anexo alterado");

    const fresh = folderOf(backup(PASS, "--encrypt").out);
    const dump = join(fresh, "banco.dump.enc");
    const dumpBytes = readFileSync(dump);
    dumpBytes[dumpBytes.length - 20] = (dumpBytes[dumpBytes.length - 20]! + 1) % 256;
    writeFileSync(dump, dumpBytes);
    const badDump = run("restore-verify.mjs", [fresh], PASS);
    expect(badDump.code).toBe(1);
    expect(badDump.out).toContain("o dump não pôde ser lido");
  }, 240_000);

  it("--encrypt sem senha, ou com senha curta, é recusado e não cria backup", () => {
    expect(backup(undefined, "--encrypt").code).toBe(2);
    const short = backup("curta", "--encrypt");
    expect(short.code).toBe(2);
    expect(short.out).toContain("ao menos 12");
    expect(readdirSync(backups)).toEqual([]);
  }, 60_000);

  it("sem --encrypt continua em claro (e avisa que NÃO está cifrado)", () => {
    const made = backup(PASS);
    expect(made.code, made.out).toBe(0);
    expect(made.out).toContain("cifrado: NÃO");
  }, 120_000);
});
