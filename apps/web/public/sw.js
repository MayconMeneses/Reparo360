// Service worker do Reparo360. Regras de segurança:
//  - NUNCA toca em /api/: dados privados não são guardados no aparelho.
//  - Guarda só arquivos com hash (/assets/) e a página-casca, que não contém dado algum.
//  - Não ativa sozinho: a nova versão espera o usuário aceitar o aviso (atualização controlada).
const SHELL_CACHE = "r360-shell-v1";

self.addEventListener("install", () => {
  // Sem skipWaiting aqui: a página mostra "nova versão disponível" e pede a troca.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/assets/")) {
    // Arquivos com hash no nome nunca mudam: cache primeiro.
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    // Rede primeiro (sempre a versão atual); sem rede, a página-casca guardada.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match("/")) ?? Response.error()),
    );
  }
});
