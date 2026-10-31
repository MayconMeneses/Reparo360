import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JPEG, loginOk, onboard, PNG, resetData, setupOrder, startTestEnv, upload, type Session, type TestEnv } from "./helpers.js";

// Roda os scripts reais (pnpm backup / backup:verify) contra o banco de TESTE e uma pasta de anexos temporária.
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
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
  backups = mkdtempSync(join(tmpdir(), "r360-backups-"));
  // Pasta de anexos limpa a cada teste (os arquivos de testes anteriores virariam "órfãos" deste).
  for (const entry of readdirSync(env.storageDir)) rmSync(join(env.storageDir, entry), { recursive: true, force: true });
  await resetData(env.migrator);
  owner = await loginOk(env, (await onboard(env, "backupA")).email);
});

const run = (script: string, ...args: string[]) => {
  const res = spawnSync("node", [join(root, "scripts", script), ...args], { cwd: root, encoding: "utf8" });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
};
const backup = () => run("backup.mjs", "--db", "reparo360_test", "--storage", env.storageDir, "--out", backups);
const folderOf = (out: string) => /backup: (.+)/.exec(out)?.[1]?.trim() ?? "";

async function twoAttachments() {
  const { orderId } = await setupOrder(env, owner);
  expect((await upload(env, owner, orderId, "image/jpeg", JPEG)).statusCode).toBe(201);
  expect((await upload(env, owner, orderId, "image/png", PNG)).statusCode).toBe(201);
}

describe("backup completo (banco + anexos)", () => {
  it("copia banco e anexos, confere cada anexo contra o SHA-256 do banco e a restauração prova o resultado", async () => {
    await twoAttachments();
    const made = backup();
    expect(made.code, made.out).toBe(0);
    expect(made.out).toContain("anexos no banco: 2");
    const folder = folderOf(made.out);
    const manifest = JSON.parse(readFileSync(join(folder, "manifesto.json"), "utf8"));
    expect(manifest.files).toHaveLength(2);
    expect(manifest.problems).toEqual([]);
    expect(manifest.tableCounts.attachments).toBe(2);
    expect(manifest.dump.sha256).toMatch(/^[0-9a-f]{64}$/);

    const verified = run("restore-verify.mjs", folder);
    expect(verified.code, verified.out).toBe(0);
    expect(verified.out).toContain("anexos conferidos: 2");
  }, 120_000);

  it("anexo apagado da pasta antes do backup: o backup acusa a falta (FAIL)", async () => {
    await twoAttachments();
    const keyDir = join(env.storageDir, readdirSync(env.storageDir)[0]!);
    rmSync(join(keyDir, readdirSync(keyDir)[0]!));
    const made = backup();
    expect(made.code).toBe(1);
    expect(made.out).toContain("ausente na cópia");
  }, 120_000);

  it("anexo corrompido na origem: o backup acusa SHA-256 diferente (FAIL)", async () => {
    await twoAttachments();
    const keyDir = join(env.storageDir, readdirSync(env.storageDir)[0]!);
    // Mesmo tamanho, um byte trocado: só o SHA-256 percebe.
    const file = join(keyDir, readdirSync(keyDir)[0]!);
    const bytes = readFileSync(file);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! + 1) % 256;
    writeFileSync(file, bytes);
    const made = backup();
    expect(made.code).toBe(1);
    expect(made.out).toContain("SHA-256 diferente");
    expect(made.out).not.toContain("tamanho diferente");
  }, 120_000);

  it("backup adulterado depois de feito: a verificação reprova anexo alterado, anexo removido e dump alterado", async () => {
    await twoAttachments();
    const folder = folderOf(backup().out);
    const files = readdirSync(join(folder, "anexos"), { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    const target = join(files[0]!.parentPath, files[0]!.name);

    appendFileSync(target, "x");
    expect(run("restore-verify.mjs", folder).out).toContain("anexo alterado");
    rmSync(target);
    expect(run("restore-verify.mjs", folder).out).toContain("anexo ausente");

    const fresh = folderOf(backup().out);
    writeFileSync(join(fresh, "banco.dump"), "lixo");
    const bad = run("restore-verify.mjs", fresh);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("o dump foi alterado");
  }, 180_000);

  it("arquivo na pasta sem registro no banco é avisado (órfão) e copiado, sem reprovar", async () => {
    await twoAttachments();
    const keyDir = join(env.storageDir, readdirSync(env.storageDir)[0]!);
    writeFileSync(join(keyDir, "00000000-0000-4000-8000-000000000000"), "sobra");
    const made = backup();
    expect(made.code, made.out).toBe(0);
    expect(made.out).toContain("sem registro (órfãos): 1");
  }, 120_000);

  it("o backup nunca sobrescreve: duas execuções geram pastas diferentes", async () => {
    await twoAttachments();
    const a = folderOf(backup().out);
    await new Promise((r) => setTimeout(r, 1100));
    const b = folderOf(backup().out);
    expect(a).not.toBe(b);
  }, 120_000);
});
