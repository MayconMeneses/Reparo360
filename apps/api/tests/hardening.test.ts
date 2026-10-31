import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FailureThrottle } from "../src/security/throttle.js";
import { call, JPEG, loginOk, login, onboard, resetData, setupOrder, startTestEnv, upload, PASSWORD, type Session, type TestEnv } from "./helpers.js";

let env: TestEnv;
let owner: Session;
let ownerEmail: string;

beforeAll(async () => {
  env = await startTestEnv({ LOGIN_RATE_LIMIT_MAX: "1000", LOGIN_ACCOUNT_MAX_FAILURES: "3" });
  await resetData(env.migrator);
  const account = await onboard(env, "hard");
  ownerEmail = account.email;
  owner = await loginOk(env, ownerEmail);
});
afterAll(async () => {
  await env.close();
});

const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (full.endsWith(".ts")) yield full;
  }
}

describe("SEC-003 mass assignment: validação de entrada estrita (verificação estática)", () => {
  it("nenhum esquema Zod frouxo na API (z.object, passthrough, loose) fora da leitura do ambiente", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcRoot)) {
      const rel = relative(srcRoot, file).replaceAll("\\", "/");
      if (rel === "config.ts") continue; // variáveis de ambiente, não entrada de usuário
      const text = readFileSync(file, "utf8");
      if (/\bz\.object\(|\.passthrough\(|\.loose\(|\blooseObject\(/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("toda leitura de corpo, query e parâmetros passa por um esquema (nenhum uso cru de request.body/query/params)", () => {
    const raw: string[] = [];
    for (const file of sourceFiles(srcRoot)) {
      const rel = relative(srcRoot, file).replaceAll("\\", "/");
      readFileSync(file, "utf8").split("\n").forEach((line, index) => {
        if (/request\.(body|query|params)/.test(line) && !/\.parse\(request\./.test(line)) raw.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
    }
    // Único uso cru permitido: o binário do upload, validado por assinatura de arquivo.
    expect(raw).toEqual([expect.stringContaining("attachments.routes.ts")]);
    expect(raw[0]).toContain("request.body as Buffer");
  });
});

describe("SEC-005 CSRF: verificação de Origin além do token", () => {
  it("requisição que altera dados vinda de outra origem é recusada, mesmo com cookie e token válidos", async () => {
    const res = await env.app.inject({
      method: "POST", url: "/api/v1/customers",
      headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, origin: "https://site-malicioso.example", host: "localhost:3000" },
      payload: { name: "Cliente Forjado", phone: "85999991234" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("ORIGEM_INVALIDA");
    expect((await call(env, owner, "GET", "/customers?q=Forjado")).json().customers).toHaveLength(0);
  });

  it("mesma origem passa; Origin malformado é recusado; leitura de outra origem não é bloqueada por esta regra", async () => {
    const same = await env.app.inject({
      method: "POST", url: "/api/v1/customers",
      headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, origin: "http://localhost:3000", host: "localhost:3000" },
      payload: { name: "Cliente Legítimo", phone: "85999990001" },
    });
    expect(same.statusCode).toBe(201);
    const bad = await env.app.inject({ method: "POST", url: "/api/v1/customers", headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, origin: "isto-nao-e-uma-url", host: "localhost:3000" }, payload: {} });
    expect(bad.statusCode).toBe(403);
    const read = await env.app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: owner.cookie, origin: "https://outro.example", host: "localhost:3000" } });
    expect(read.statusCode).toBe(200);
  });
});

describe("SEC-010 upload: arquivo poliglota (cabeçalho de imagem + conteúdo ativo)", () => {
  it("é entregue sempre como anexo, com o tipo verificado e nosniff, nunca como página", async () => {
    const { orderId } = await setupOrder(env, owner);
    const polyglot = Buffer.concat([JPEG, Buffer.from("<html><script>document.cookie</script></html>")]);
    const sent = await upload(env, owner, orderId, "image/jpeg", polyglot);
    expect(sent.statusCode).toBe(201); // a assinatura é de JPEG; o conteúdo extra não vira página
    const got = await call(env, owner, "GET", `/attachments/${sent.json().id}`);
    expect(got.headers["content-type"]).toBe("image/jpeg");
    expect(got.headers["content-disposition"]).toBe("attachment");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.headers["content-security-policy"]).toContain("default-src 'self'");
  });
});

describe("SEC-006 força bruta: limite por conta e IP", () => {
  it("depois de N falhas, aquela combinação IP+conta recebe 429, até com a senha certa; outra conta no mesmo IP segue livre", async () => {
    const victim = await onboard(env, "vitima");
    const other = await onboard(env, "outra");
    const attempt = (email: string, password: string) => login(env, email, undefined, password);
    for (let i = 0; i < 3; i++) expect((await attempt(victim.email, "senha-errada-123456")).res.statusCode).toBe(401);
    const blocked = await attempt(victim.email, PASSWORD); // senha CERTA, mas a combinação está bloqueada
    expect(blocked.res.statusCode).toBe(429);
    expect(blocked.res.json().error.code).toBe("MUITAS_TENTATIVAS");
    expect((await attempt(other.email, PASSWORD)).res.statusCode).toBe(200);
  });

  it("login com sucesso zera o contador (não acumula falhas antigas)", async () => {
    const acc = await onboard(env, "zera");
    for (let i = 0; i < 2; i++) await login(env, acc.email, undefined, "senha-errada-123456");
    expect((await login(env, acc.email)).res.statusCode).toBe(200);
    for (let i = 0; i < 2; i++) await login(env, acc.email, undefined, "senha-errada-123456");
    expect((await login(env, acc.email)).res.statusCode).toBe(200);
  });
});

describe("FailureThrottle (unidade)", () => {
  it("janela deslizante: falhas antigas deixam de contar", () => {
    let now = 0;
    const throttle = new FailureThrottle(3, 1000, () => now);
    for (let i = 0; i < 3; i++) throttle.fail("k");
    expect(throttle.isBlocked("k")).toBe(true);
    now = 1001;
    expect(throttle.isBlocked("k")).toBe(false);
  });
  it("chaves independentes e reset", () => {
    const throttle = new FailureThrottle(2, 1000);
    throttle.fail("a"); throttle.fail("a");
    expect(throttle.isBlocked("a")).toBe(true);
    expect(throttle.isBlocked("b")).toBe(false);
    throttle.reset("a");
    expect(throttle.isBlocked("a")).toBe(false);
  });
});
