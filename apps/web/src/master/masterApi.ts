// Cliente do Master. Separado do cliente das assistências: outro cookie, outro token CSRF (só em memória).
export class MasterApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "MasterApiError";
  }
}

let csrfToken: string | null = null;
export const setMasterCsrf = (token: string | null) => { csrfToken = token; };

export async function masterApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  const response = await fetch(`/api/v1/master${path}`, {
    method,
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!response.ok) throw new MasterApiError(response.status, data?.error?.code ?? "ERRO", data?.error?.message ?? "Não foi possível concluir a operação.");
  return data as T;
}

export interface TenantRow {
  id: string;
  name: string;
  tradeName: string | null;
  status: string;
  createdAt: string;
  activeMembers: number;
  workOrders: number;
}

export const TENANT_STATUS_LABEL: Record<string, string> = {
  em_configuracao: "Em configuração", em_teste: "Em teste", ativa: "Ativa", suspensa: "Suspensa", cancelada: "Cancelada",
};
