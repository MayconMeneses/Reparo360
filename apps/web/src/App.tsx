import type { Permission } from "@reparo360/domain";
import { useEffect, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Loading } from "./components/parts";
import { BenchPage } from "./pages/BenchPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AuditPage } from "./pages/AuditPage";
import { LabelPage } from "./pages/LabelPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { OrderPage } from "./pages/OrderPage";
import { DevicesPage, QuotesPage } from "./pages/lists";
import { TeamPage } from "./pages/TeamPage";
import { CustomerDetailPage, CustomerNewPage, CustomersPage } from "./pages/customers";
import { OrderNewPage } from "./pages/OrderNewPage";
import { OrdersPage } from "./pages/OrdersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { isKnownPath, titleFor } from "./routes";

function NotFound() {
  return (
    <>
      <h1>Página não encontrada</h1>
      <p>O endereço que você abriu não existe.</p>
      <p><Link to="/">Voltar ao início</Link></p>
    </>
  );
}

/** Tela sem permissão para o papel atual. O servidor já recusa os dados; isto só evita uma tela quebrada. */
function Allowed({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (can(permission)) return <>{children}</>;
  return (
    <>
      <h1>Sem permissão</h1>
      <p>Sua função não tem acesso a esta tela. Use o menu para voltar.</p>
    </>
  );
}

/** Quem não tem acesso ao Dashboard (atendente, técnico) cai direto nas ordens. */
function Home() {
  const { can } = useAuth();
  if (can("report.operational.read")) return <DashboardPage />;
  return <Navigate to={can("work_order.claim") ? "/bancada" : "/ordens"} replace />;
}

export function App() {
  const { status, me } = useAuth();
  const { pathname } = useLocation();
  // Sem sessão, qualquer endereço conhecido mostra o login: o título tem de dizer isso.
  useEffect(() => { document.title = status === "anonymous" && isKnownPath(pathname) ? "Entrar — Reparo360" : titleFor(pathname); }, [pathname, status]);
  // Endereço inexistente mostra a página 404 (com caminho de volta), logado ou não.
  if (!isKnownPath(pathname)) return <main style={{ padding: 16 }}><NotFound /></main>;
  if (status === "loading") return <Loading />;
  if (status === "anonymous") return <LoginPage />;
  if (me?.senhaTemporaria) return <ChangePasswordPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="ordens" element={<Allowed permission="work_order.read"><OrdersPage /></Allowed>} />
        <Route path="ordens/nova" element={<Allowed permission="work_order.create"><OrderNewPage /></Allowed>} />
        <Route path="ordens/:id" element={<Allowed permission="work_order.read"><OrderPage /></Allowed>} />
        <Route path="bancada" element={<Allowed permission="work_order.claim"><BenchPage /></Allowed>} />
        <Route path="etiqueta/:id" element={<Allowed permission="document.generate"><LabelPage /></Allowed>} />
        <Route path="clientes" element={<Allowed permission="customer.read"><CustomersPage /></Allowed>} />
        <Route path="clientes/novo" element={<Allowed permission="customer.create"><CustomerNewPage /></Allowed>} />
        <Route path="clientes/:id" element={<Allowed permission="customer.read"><CustomerDetailPage /></Allowed>} />
        <Route path="equipamentos" element={<Allowed permission="device.read"><DevicesPage /></Allowed>} />
        <Route path="orcamentos" element={<Allowed permission="quote.read"><QuotesPage /></Allowed>} />
        <Route path="auditoria" element={<Allowed permission="audit.read"><AuditPage /></Allowed>} />
        <Route path="equipe" element={<Allowed permission="team.manage"><TeamPage /></Allowed>} />
        <Route path="configuracoes" element={<Allowed permission="tenant.settings.write"><SettingsPage /></Allowed>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
