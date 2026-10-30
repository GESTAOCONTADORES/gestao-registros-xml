import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Bell,
  Building2,
  ClipboardList,
  FileBarChart2,
  FolderSearch,
  History,
  LayoutDashboard,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { AgentIndicator } from './AgentIndicator';
import { ImportProgress } from './ImportProgress';
import { ImportSummary } from './ImportSummary';
import { Logo } from './Logo';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  admin?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/pesquisar', label: 'Pesquisar arquivos', icon: FolderSearch },
  { to: '/registros', label: 'Registros', icon: ClipboardList },
  { to: '/empresas', label: 'Empresas', icon: Building2, admin: true },
  { to: '/relatorios', label: 'Relatórios', icon: FileBarChart2 },
  { to: '/notificacoes', label: 'Notificações', icon: Bell },
  { to: '/usuarios', label: 'Usuários', icon: Users, admin: true },
  { to: '/historico', label: 'Histórico', icon: History },
  { to: '/auditoria', label: 'Auditoria', icon: ShieldCheck, admin: true },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, admin: true },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isMaster } = useAuth();
  const items = NAV.filter((i) => !i.admin || isMaster);
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-navy-950/40 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-navy-900 text-white transition-transform lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-5 lg:hidden">
          <span className="font-bold">Menu</span>
          <button onClick={onClose} aria-label="Fechar menu">
            <X size={20} />
          </button>
        </div>
        <div className="px-5 pt-6 pb-3">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-orange-400 uppercase">Departamento Pessoal</p>
          <p className="text-sm font-bold tracking-wide">REGISTROS XML-PDF</p>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Menu principal">
          {items.map((item) => {
            return (
              <div key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-100 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon size={18} className={isActive ? 'text-orange-500' : 'text-navy-100 group-hover:text-orange-400'} />
                      <span className="flex-1">{item.label}</span>
                      {item.admin && <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-orange-400 uppercase">Master</span>}
                    </>
                  )}
                </NavLink>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-[11px] text-navy-100">
          Gestão Contadores — Departamento Pessoal
        </div>
      </aside>
    </>
  );
}

export function Header({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:px-6">
      <button className="rounded-lg p-2 text-navy-900 hover:bg-navy-50 lg:hidden" onClick={onMenu} aria-label="Abrir menu">
        <Menu size={20} />
      </button>
      <NavLink to="/" className="flex items-center gap-3" aria-label="Início">
        <Logo className="h-9" />
      </NavLink>
      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <div className="hidden sm:block">
          <AgentIndicator />
        </div>
        <NotificationBell />
        <div className="h-8 w-px bg-line" />
        <UserMenu />
      </div>
    </header>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <div className="flex h-full flex-col">
      <Header onMenu={() => setOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <Sidebar open={open} onClose={() => setOpen(false)} />
        <main className="min-w-0 flex-1 overflow-y-auto bg-[#fafbfd]">
          <div className="mx-auto max-w-[1500px] p-4 lg:p-6">
            <Outlet />
          </div>
        </main>
      </div>
      <ImportProgress />
      <ImportSummary />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        <div className="mt-2 h-1 w-12 rounded-full bg-orange-500" />
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
