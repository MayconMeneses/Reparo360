export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

// O token CSRF fica só em memória (nunca em localStorage). Depois de recarregar a página, vem de /me.
let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const setCsrfToken = (token: string | null) => { csrfToken = token; };
export const setUnauthorizedHandler = (handler: (() => void) | null) => { onUnauthorized = handler; };

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (MUTATING.has(method) && csrfToken) headers["x-csrf-token"] = csrfToken;

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
    signal: init.signal,
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!response.ok) {
    if (response.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(response.status, data?.error?.code ?? "ERRO", data?.error?.message ?? "Não foi possível concluir a operação.", data?.error?.details);
  }
  return data as T;
}
