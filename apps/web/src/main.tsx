import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { applyTheme, readTheme } from "./theme";
import "./styles/tokens.css";
import "./styles/app.css";

applyTheme(readTheme());

const root = document.getElementById("root");
if (!root) throw new Error("elemento #root não encontrado");
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
