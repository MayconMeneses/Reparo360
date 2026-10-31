import type { Permission } from "@reparo360/domain";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";
import { ROLE_LABEL } from "../format";
import { applyTheme, readTheme, type ThemePreference } from "../theme";

// Só entram itens que têm tela e endpoint de verdade (spec 19.3: sem botões falsos).
// Fora do menu, de propósito: Relatórios (o Dashboard já cobre os indicadores do MVP).
const MENU: Array<{ to: string; label: string; permission: Permission; end?: boolean }> = [
  { to: "/", label: "Dashboard", permission: "report.operational.read", end: true },
  { to: "/bancada", label: "Bancada", permission: "work_order.claim" },
  { to: "/ordens", label: "Ordens", permission: "work_order.read" },
  { to: "/clientes", label: "Clientes", permission: "customer.read" },
  { to: "/equipamentos", label: "Equipamentos", permission: "device.read" },
  { to: "/orcamentos", label: "Orçamentos", permission: "quote.read" },
  { to: "/equipe", label: "Equipe", permission: "team.manage" },
  { to: "/configuracoes", label: "Configurações", permission: "tenant.settings.write" },
];

export function Layout() {
  const { me, can, logout } = useAuth();
  const [theme, setTheme] = useState<ThemePreference>(readTheme);

  return (
    <>
      <a className="skip-link" href="#conteudo">Ir para o conteúdo</a>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">Reparo360</div>
          <nav aria-label="Principal">
            <ul>
              {MENU.filter((item) => can(item.permission)).map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end}>{item.label}</NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <div className="main">
          <header className="topbar">
            <span className="who">{me?.tenant.name} · {me?.user.name} ({me ? ROLE_LABEL[me.role] : ""})</span>
            <div className="actions">
              <label htmlFor="theme" style={{ margin: 0 }}>Tema</label>
              <select
                id="theme"
                value={theme}
                style={{ width: "auto" }}
                onChange={(event) => {
                  const next = event.target.value as ThemePreference;
                  setTheme(next);
                  applyTheme(next);
                }}
              >
                <option value="system">Seguir o sistema</option>
                <option value="light">Claro</option>
                <option value="dark">Escuro</option>
              </select>
              <button type="button" onClick={() => void logout()}>Sair</button>
            </div>
          </header>
          <main id="conteudo" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </>
  );
}
