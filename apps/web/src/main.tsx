import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { UpdateBanner } from "./pwa";
import { applyTheme, readTheme } from "./theme";
import "./styles/tokens.css";
import "./styles/app.css";

applyTheme(readTheme());

const PortalPage = lazy(() => import("./pages/PortalPage").then((m) => ({ default: m.PortalPage })));
const isPortal = window.location.pathname === "/portal";

const root = document.getElementById("root");
if (!root) throw new Error("elemento #root não encontrado");
createRoot(root).render(
  <StrictMode>
    <UpdateBanner />
    {isPortal ? (
      // O portal do consumidor é público: sem login, sem /me, em um pacote separado.
      <Suspense fallback={<p role="status">Carregando…</p>}>
        <PortalPage />
      </Suspense>
    ) : (
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    )}
  </StrictMode>,
);
