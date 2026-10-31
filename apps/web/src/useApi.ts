import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

export type Remote<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/**
 * Busca GET com estados de carregando/erro e cancelamento ao sair da tela.
 * Ao recarregar o MESMO endereço, mantém os dados atuais na tela até chegarem os novos
 * (formulários abertos não são desmontados nem perdem o que foi digitado).
 */
export function useApi<T>(path: string | null): Remote<T> & { reload: () => void } {
  const [state, setState] = useState<Remote<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const loadedPath = useRef<string | null>(null);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    if (loadedPath.current !== path) setState({ status: "loading" });
    api<T>(path, { signal: controller.signal }).then(
      (data) => { loadedPath.current = path; setState({ status: "ready", data }); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof ApiError ? error.message : "Falha de conexão. Tente novamente." });
      },
    );
    return () => controller.abort();
  }, [path, tick]);

  return { ...state, reload };
}
