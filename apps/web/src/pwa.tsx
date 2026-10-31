import { useEffect, useRef, useState } from "react";

/** Registra o service worker só em produção. Falha de registro não afeta o uso do sistema. */
export function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  // A página só recarrega quando a PESSOA pede a atualização. Na primeira visita o service worker assume o controle
  // sozinho (controllerchange) e recarregar aí apagaria o que a pessoa já estivesse digitando, por exemplo o login.
  const updateRequested = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let reloading = false;
    const onControllerChange = () => {
      if (!updateRequested.current || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker.register("/sw.js").then(
      (registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const incoming = registration.installing;
          incoming?.addEventListener("statechange", () => {
            // "installed" com um controlador ativo = há versão antiga rodando e uma nova esperando.
            if (incoming.state === "installed" && navigator.serviceWorker.controller) setWaiting(incoming);
          });
        });
      },
      () => undefined,
    );
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" className="card" style={{ position: "fixed", bottom: 16, left: 16, right: 16, maxWidth: 480, zIndex: 20 }}>
      <p style={{ marginTop: 0 }}>Há uma nova versão do Reparo360.</p>
      <button type="button" className="primary" onClick={() => { updateRequested.current = true; waiting.postMessage("SKIP_WAITING"); }}>Atualizar agora</button>{" "}
      <button type="button" onClick={() => setWaiting(null)}>Depois</button>
    </div>
  );
}
