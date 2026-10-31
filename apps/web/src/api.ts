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

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { ...init.headers };
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

/** Envia um arquivo como corpo binário (o servidor confere o tipo pelo conteúdo, não pelo que declaramos). */
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const headers: Record<string, string> = { "content-type": file.type };
  if (csrfToken) headers["x-csrf-token"] = csrfToken;
  const response = await fetch(`/api/v1${path}`, { method: "POST", headers, body: file, credentials: "same-origin" });
  const data = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    if (response.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(response.status, data?.error?.code ?? "ERRO", data?.error?.message ?? "Não foi possível enviar o arquivo.");
  }
  return data as T;
}

/** Mensagem do servidor, com os motivos detalhados quando ele os envia (ex.: por que os testes não liberam). */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Falha de conexão. Tente novamente.";
  const reasons = (error.details as { reasons?: unknown } | undefined)?.reasons;
  const list = Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === "string") : [];
  return list.length > 0 ? `${error.message} Motivo: ${list.join("; ")}.` : error.message;
}
