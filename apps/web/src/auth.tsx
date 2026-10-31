import { hasPermission, type Permission, type TenantRole } from "@reparo360/domain";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, setCsrfToken, setUnauthorizedHandler } from "./api";

interface Me {
  user: { id: string; name: string; email: string };
  tenant: { id: string; name: string };
  role: TenantRole;
  csrfToken: string;
}

interface AuthState {
  status: "loading" | "anonymous" | "authenticated";
  me: Me | null;
  /** Só reflete a interface: a decisão de acesso é sempre do servidor. */
  can: (permission: Permission) => boolean;
  login: (input: { email: string; password: string; tenantId?: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [me, setMe] = useState<Me | null>(null);

  const adopt = useCallback((value: Me | null) => {
    setMe(value);
    setCsrfToken(value?.csrfToken ?? null);
    setStatus(value ? "authenticated" : "anonymous");
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => adopt(null));
    api<Me>("/me").then(adopt, () => adopt(null));
    return () => setUnauthorizedHandler(null);
  }, [adopt]);

  const login = useCallback(async (input: { email: string; password: string; tenantId?: string }) => {
    await api("/auth/login", { method: "POST", body: input });
    adopt(await api<Me>("/me"));
  }, [adopt]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch((error: unknown) => {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    });
    adopt(null);
  }, [adopt]);

  const value = useMemo<AuthState>(
    () => ({ status, me, login, logout, can: (permission) => (me ? hasPermission(me.role, permission) : false) }),
    [status, me, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fora do AuthProvider");
  return ctx;
}
