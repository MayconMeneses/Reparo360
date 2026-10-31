import { useEffect, useState } from "react";

/** O que o servidor oferece (hoje: recuperação de senha e convite por e-mail, que dependem do envio de e-mail estar ligado). */
export function useAuthOptions(): { passwordReset: boolean } {
  const [options, setOptions] = useState({ passwordReset: false });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/auth/options", { credentials: "omit", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { passwordReset?: boolean } | null) => { if (data) setOptions({ passwordReset: data.passwordReset === true }); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return options;
}
