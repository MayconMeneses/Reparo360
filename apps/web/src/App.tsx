import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { Loading } from "./components/parts";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { CustomersPage, DevicesPage, OrdersPage, QuotesPage, TeamPage } from "./pages/lists";
import { SettingsPage } from "./pages/SettingsPage";

function NotFound() {
  return (
    <>
      <h1>Página não encontrada</h1>
      <p>O endereço que você abriu não existe. Use o menu para voltar.</p>
    </>
  );
}

/** Quem não tem acesso ao Dashboard (atendente, técnico) cai direto nas ordens. */
function Home() {
  const { can } = useAuth();
  return can("report.operational.read") ? <DashboardPage /> : <Navigate to="/ordens" replace />;
}

export function App() {
  const { status } = useAuth();
  if (status === "loading") return <Loading />;
  if (status === "anonymous") return <LoginPage />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="ordens" element={<OrdersPage />} />
        <Route path="ordens/:id" element={<OrderDetailPage />} />
        <Route path="clientes" element={<CustomersPage />} />
        <Route path="equipamentos" element={<DevicesPage />} />
        <Route path="orcamentos" element={<QuotesPage />} />
        <Route path="equipe" element={<TeamPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
