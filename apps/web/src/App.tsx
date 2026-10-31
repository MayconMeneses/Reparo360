import { useEffect } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Loading } from "./components/parts";
import { BenchPage } from "./pages/BenchPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LabelPage } from "./pages/LabelPage";
import { LoginPage } from "./pages/LoginPage";
import { OrderPage } from "./pages/OrderPage";
import { DevicesPage, QuotesPage, TeamPage } from "./pages/lists";
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

/** Quem não tem acesso ao Dashboard (atendente, técnico) cai direto nas ordens. */
function Home() {
  const { can } = useAuth();
  if (can("report.operational.read")) return <DashboardPage />;
  return <Navigate to={can("work_order.claim") ? "/bancada" : "/ordens"} replace />;
}

export function App() {
  const { status } = useAuth();
  const { pathname } = useLocation();
  // Sem sessão, qualquer endereço conhecido mostra o login: o título tem de dizer isso.
  useEffect(() => { document.title = status === "anonymous" && isKnownPath(pathname) ? "Entrar — Reparo360" : titleFor(pathname); }, [pathname, status]);
  // Endereço inexistente mostra a página 404 (com caminho de volta), logado ou não.
  if (!isKnownPath(pathname)) return <main style={{ padding: 16 }}><NotFound /></main>;
  if (status === "loading") return <Loading />;
  if (status === "anonymous") return <LoginPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="ordens" element={<OrdersPage />} />
        <Route path="ordens/nova" element={<OrderNewPage />} />
        <Route path="ordens/:id" element={<OrderPage />} />
        <Route path="bancada" element={<BenchPage />} />
        <Route path="etiqueta/:id" element={<LabelPage />} />
        <Route path="clientes" element={<CustomersPage />} />
        <Route path="clientes/novo" element={<CustomerNewPage />} />
        <Route path="clientes/:id" element={<CustomerDetailPage />} />
        <Route path="equipamentos" element={<DevicesPage />} />
        <Route path="orcamentos" element={<QuotesPage />} />
        <Route path="equipe" element={<TeamPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
