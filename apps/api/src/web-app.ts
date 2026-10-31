import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

// Endereços que a interface conhece. Qualquer outro responde 404 DE VERDADE (a mesma página, com status 404):
// o navegador e os verificadores veem que o endereço não existe, em vez de um 200 genérico.
const KNOWN_ROUTES = [
  /^\/$/, /^\/portal$/, /^\/master$/, /^\/ordens$/, /^\/ordens\/[0-9a-f-]{36}$/, /^\/ordens\/nova$/, /^\/clientes$/, /^\/clientes\/novo$/, /^\/clientes\/[0-9a-f-]{36}$/, /^\/equipamentos$/, /^\/orcamentos$/, /^\/equipe$/, /^\/auditoria$/, /^\/esqueci-senha$/, /^\/redefinir-senha$/,
  /^\/configuracoes$/, /^\/bancada$/, /^\/etiqueta\/[0-9a-f-]{36}$/,
];

// Lista positiva de tipos servidos como arquivo. O resto cai na página (200 ou 404).
const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * Serve a interface (build do Vite) no MESMO ORIGEM da API: o cookie é SameSite=Strict e não há CORS.
 * Arquivos com hash em /assets são imutáveis; HTML e service worker nunca ficam em cache (atualização controlada).
 */
export async function createWebHandler(webRoot: string) {
  const root = resolve(webRoot);
  const html = await readFile(join(root, "index.html"), "utf8");

  const page = (reply: FastifyReply, status: number) =>
    reply.code(status).header("content-type", "text/html; charset=utf-8").header("cache-control", "no-cache").send(html);

  return async function handle(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const path = decodeURIComponentSafe(request.url.split("?")[0] ?? "/");
    const type = CONTENT_TYPES[extname(path).toLowerCase()];
    if (type && path !== "/") {
      const full = resolve(root, `.${path}`);
      // Nunca sai da pasta da interface (barra "..", caminho absoluto, etc.).
      if (full.startsWith(root + sep) && (await stat(full).then((s) => s.isFile(), () => false))) {
        const immutable = path.startsWith("/assets/");
        return reply
          .header("content-type", type)
          .header("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache")
          .send(await readFile(full));
      }
      return reply.code(404).header("content-type", "text/plain; charset=utf-8").send("Não encontrado");
    }
    return page(reply, KNOWN_ROUTES.some((route) => route.test(path)) ? 200 : 404);
  };
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "/__invalido__";
  }
}
