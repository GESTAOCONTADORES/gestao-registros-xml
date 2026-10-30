import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppLayout } from './components/Layout';
import { Logo } from './components/Logo';
import { EmptyState, LoadingState } from './components/States';
import { ActiveRunProvider } from './runs/ActiveRunProvider';
import { AuditPage, NotificationsPage, SettingsPage } from './pages/AdminPages';
import { LoginPage, RequestAccessPage } from './pages/AuthPages';
import { CompaniesPage } from './pages/CompaniesPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryDetailPage, HistoryPage } from './pages/HistoryPages';
import { RecordsPage } from './pages/RecordsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SearchPage } from './pages/SearchPage';
import { UsersPage } from './pages/UsersPage';

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <Logo className="h-12" />
      <LoadingState label="Carregando sessão…" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

/** Rotas administrativas: a interface esconde e bloqueia; a API também responde 403. */
function RequireMaster({ children }: { children: ReactNode }) {
  const { isMaster } = useAuth();
  if (!isMaster) return <EmptyState title="Acesso restrito" message="Esta área é exclusiva do perfil Master." />;
  return <>{children}</>;
}

export function App() {
  const { loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={loading ? <Splash /> : <LoginPage />} />
      <Route path="/solicitar-acesso" element={<RequestAccessPage />} />
      <Route
        element={
          <RequireAuth>
            <ActiveRunProvider>
              <AppLayout />
            </ActiveRunProvider>
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="pesquisar" element={<SearchPage />} />
        <Route path="registros" element={<RecordsPage />} />
        <Route path="relatorios" element={<ReportsPage />} />
        <Route path="notificacoes" element={<NotificationsPage />} />
        <Route path="historico" element={<HistoryPage />} />
        <Route path="historico/:id" element={<HistoryDetailPage />} />
        <Route path="empresas" element={<RequireMaster><CompaniesPage /></RequireMaster>} />
        <Route path="usuarios" element={<RequireMaster><UsersPage /></RequireMaster>} />
        <Route path="auditoria" element={<RequireMaster><AuditPage /></RequireMaster>} />
        <Route path="configuracoes" element={<RequireMaster><SettingsPage /></RequireMaster>} />
        <Route path="*" element={<EmptyState title="Página não encontrada" />} />
      </Route>
    </Routes>
  );
}
