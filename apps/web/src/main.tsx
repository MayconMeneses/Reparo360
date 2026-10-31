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
const MasterApp = lazy(() => import("./master/MasterApp").then((m) => ({ default: m.MasterApp })));
const ForgotPasswordPage = lazy(() => import("./pages/PasswordPages").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("./pages/PasswordPages").then((m) => ({ default: m.ResetPasswordPage })));
const path = window.location.pathname;
const isPortal = path === "/portal";
const isMaster = path === "/master";
const isForgot = path === "/esqueci-senha";
const isReset = path === "/redefinir-senha";

const root = document.getElementById("root");
if (!root) throw new Error("elemento #root não encontrado");
createRoot(root).render(
  <StrictMode>
    <UpdateBanner />
    {isForgot || isReset ? (
      // Páginas públicas de senha: antes de qualquer login, sem /me, em pacote separado.
      <Suspense fallback={<p role="status">Carregando…</p>}>
        {isForgot ? <ForgotPasswordPage /> : <ResetPasswordPage />}
      </Suspense>
    ) : isMaster ? (
      // Administração da plataforma: entrada própria (senha + código), pacote separado, sem o login das assistências.
      <Suspense fallback={<p role="status">Carregando…</p>}>
        <MasterApp />
      </Suspense>
    ) : isPortal ? (
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
