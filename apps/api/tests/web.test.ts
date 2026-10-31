import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestEnv, type TestEnv } from "./helpers.js";

let env: TestEnv;
let bare: TestEnv;
let base: string;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "reparo360-web-"));
  const dist = join(base, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "index.html"), "<!doctype html><html lang=\"pt-BR\"><title>Reparo360</title><div id=\"root\"></div>");
  await writeFile(join(dist, "assets", "app-abc123.js"), "console.log('app')");
  await writeFile(join(dist, "robots.txt"), "User-agent: *\nDisallow: /\n");
  await writeFile(join(dist, "sw.js"), "// service worker");
  await writeFile(join(base, "segredo.txt"), "CONTEUDO-FORA-DA-PASTA");
  env = await startTestEnv({ WEB_DIST: dist });
  bare = await startTestEnv();
});
afterAll(async () => {
  await env.close();
  await bare.close();
  await rm(base, { recursive: true, force: true });
});

const get = (e: TestEnv, url: string) => e.app.inject({ method: "GET", url });

describe("interface servida pela API", () => {
  it("rotas conhecidas respondem 200 com a página, sem cache", async () => {
    for (const url of ["/", "/portal", "/ordens", `/ordens/${randomUUID()}`, "/clientes", "/equipamentos", "/orcamentos", "/equipe", "/auditoria", "/master", "/configuracoes", "/bancada", `/etiqueta/${randomUUID()}`]) {
      const res = await get(env, url);
      expect(res.statusCode, url).toBe(200);
      expect(res.headers["content-type"], url).toContain("text/html");
      expect(res.headers["cache-control"], url).toBe("no-cache");
      expect(res.body).toContain("<div id=\"root\">");
    }
    expect((await get(env, "/ordens?busca=abc")).statusCode).toBe(200);
  });

  it("endereço inexistente responde 404 de verdade (com a página), não 200", async () => {
    for (const url of ["/nao-existe", "/ordens/abc", "/ordens/123", "/clientes/x", `/ordens/${randomUUID()}/extra`, "/.env", "/admin"]) {
      const res = await get(env, url);
      expect(res.statusCode, url).toBe(404);
      expect(res.headers["content-type"], url).toContain("text/html");
    }
  });

  it("API desconhecida continua devolvendo JSON 404; a interface não engole a API", async () => {
    const res = await get(env, "/api/v1/rota-inexistente");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NAO_ENCONTRADO");
    const post = await env.app.inject({ method: "POST", url: "/nao-existe", payload: {} });
    expect(post.statusCode).toBe(404);
    expect(post.json().error.code).toBe("NAO_ENCONTRADO");
  });

  it("arquivos com hash são imutáveis; robots.txt bloqueia indexação; service worker nunca fica em cache", async () => {
    const asset = await get(env, "/assets/app-abc123.js");
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/javascript");
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const robots = await get(env, "/robots.txt");
    expect(robots.statusCode).toBe(200);
    expect(robots.body).toContain("Disallow: /");
    expect((await get(env, "/sw.js")).headers["cache-control"]).toBe("no-cache");
    expect((await get(env, "/assets/inexistente.js")).statusCode).toBe(404);
  });

  it("não sai da pasta da interface (caminhos com .. e codificados)", async () => {
    for (const url of ["/assets/../../segredo.txt", "/..%2fsegredo.txt", "/%2e%2e/segredo.txt", "/assets/%2e%2e%2f%2e%2e%2fsegredo.txt", "/%00.js"]) {
      const res = await get(env, url);
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain("CONTEUDO-FORA-DA-PASTA");
    }
  });

  it("cabeçalhos de segurança presentes e a API continua sem cache", async () => {
    const page = await get(env, "/");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    expect(page.headers["content-security-policy"]).toContain("default-src 'self'");
    const csp = String(page.headers["content-security-policy"]);
    expect(csp).toContain("style-src 'self';"); // sem https: genérico e sem unsafe-inline em blocos <style>
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).toContain("font-src 'self';");
    expect(csp).not.toMatch(/style-src [^;]*unsafe-inline/);
    expect(page.headers["permissions-policy"]).toContain("camera=(self)");
    expect(page.headers["permissions-policy"]).toContain("microphone=()");
    expect(page.headers["x-frame-options"]).toBeTruthy();
    expect((await get(env, "/health")).headers["cache-control"]).toBe("no-store");
  });

  it("sem WEB_DIST, a API não serve interface (404 JSON)", async () => {
    const res = await get(bare, "/");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NAO_ENCONTRADO");
  });
});
