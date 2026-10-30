import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Server, FolderOpen, FileBarChart2, Clock, BellRing } from 'lucide-react';
import { AUDIT_ACTION_LABELS, type AuditAction, type AuditLogDTO, type Paginated, type SettingsDTO } from '@gestao/shared';
import { get, patch } from '../api/client';
import { PageHeader } from '../components/Layout';
import { NotificationCenter } from '../components/NotificationBell';
import { Pagination } from '../components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toasts';
import { WindowsNotificationsToggle } from '../components/UserMenu';
import { errorMessage, fmtDateTime } from '../lib/format';

export function NotificationsPage() {
  return (
    <>
      <PageHeader title="Notificações" subtitle="Mini relatórios de cada atividade do robô e avisos do sistema." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
        <div className="card min-h-[400px] overflow-hidden">
          <NotificationCenter />
        </div>
        <div className="card h-fit p-4">
          <h3 className="card-title mb-3 flex items-center gap-2">
            <BellRing size={16} className="text-orange-500" /> Neste navegador
          </h3>
          <WindowsNotificationsToggle />
          <p className="mt-3 text-xs text-muted">Quando ativadas, você recebe uma notificação do Windows ao término de cada pesquisa, mesmo com o sistema em segundo plano.</p>
        </div>
      </div>
    </>
  );
}

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const q = useQuery({
    queryKey: ['audit', page, action, dateFrom, dateTo],
    queryFn: () => get<Paginated<AuditLogDTO>>('/audit', { page, action: action || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader title="Auditoria" subtitle="Registro de acessos, alterações, pesquisas, relatórios e downloads." />
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-3">
          <div className="min-w-[240px]">
            <label className="label" htmlFor="a-action">
              Ação
            </label>
            <select id="a-action" className="input" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
              <option value="">Todas</option>
              {(Object.keys(AUDIT_ACTION_LABELS) as AuditAction[]).map((a) => (
                <option key={a} value={a}>
                  {AUDIT_ACTION_LABELS[a]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="a-from">
              De
            </label>
            <input id="a-from" type="date" className="input" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          </div>
          <div>
            <label className="label" htmlFor="a-to">
              Até
            </label>
            <input id="a-to" type="date" className="input" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </div>
        </div>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState title="Nenhum evento encontrado" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data e hora</th>
                    <th>Usuário</th>
                    <th>Ação</th>
                    <th>Entidade</th>
                    <th>IP</th>
                    <th>Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((a) => (
                    <tr key={a.id}>
                      <td className="text-xs whitespace-nowrap">{fmtDateTime(a.createdAt)}</td>
                      <td className="text-sm">{a.userName ?? '—'}</td>
                      <td>
                        <StatusBadge tone={a.action.includes('FAILED') || a.action.includes('BLOCK') || a.action.includes('DELETE') ? 'red' : a.action === 'DOWNLOAD' ? 'navy' : 'gray'}>
                          {AUDIT_ACTION_LABELS[a.action as AuditAction] ?? a.action}
                        </StatusBadge>
                      </td>
                      <td className="text-xs">{a.entity ? `${a.entity}${a.entityId ? ` #${a.entityId}` : ''}` : '—'}</td>
                      <td className="font-mono text-xs">{a.ip ?? '—'}</td>
                      <td className="max-w-[360px]">
                        {a.details ? (
                          <code className="block truncate text-[11px] text-muted" title={JSON.stringify(a.details, null, 1)}>
                            {JSON.stringify(a.details)}
                          </code>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} />
          </>
        )}
      </div>
    </>
  );
}

export function SettingsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<SettingsDTO>('/settings'), refetchInterval: 20_000 });
  const [saving, setSaving] = useState(false);
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const toggleEmail = async () => {
    setSaving(true);
    try {
      const next = await patch<SettingsDTO>('/settings', { emailNotificationsEnabled: !s.emailNotificationsEnabled });
      qc.setQueryData(['settings'], next);
      toast(`Notificações por e-mail ${next.emailNotificationsEnabled ? 'ativadas' : 'desativadas'}.`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSaving(false);
    }
  };
  const row = (icon: React.ReactNode, label: string, value: React.ReactNode, hint?: React.ReactNode) => (
    <div className="flex items-start gap-3 border-b border-line py-4 last:border-0">
      <div className="rounded-lg bg-navy-50 p-2 text-navy-800">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
        <div className="mt-0.5 text-sm text-ink">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
  return (
    <>
      <PageHeader title="Configurações" subtitle="Parâmetros do sistema e do Agente Windows." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="card px-5 py-1">
          {row(
            <FolderOpen size={18} />,
            'Caminho monitorado',
            <span className="font-mono break-all">{s.monitoredPath ?? 'G:\\Drives compartilhados\\Departamento Pessoal\\REGISTROS ROBO XML - PDF'}</span>,
            s.monitoredPath ? 'Informado pelo agente. Para alterar, edite o .env do Gestão XML Agent no servidor Windows (por segurança, a web não define caminhos).' : 'Aguardando o primeiro contato do agente.',
          )}
          {row(
            <FileBarChart2 size={18} />,
            'Relatórios',
            <span className="font-mono break-all">{s.reportsPath ?? 'G:\\Drives compartilhados\\Departamento Pessoal\\REGISTROS ROBO XML - PDF\\RELATORIOS ROBO'}</span>,
            'Todo relatório PDF gerado é salvo automaticamente pelo agente nesta pasta (ano / mês).',
          )}
          {row(
            <Server size={18} />,
            'Agente Windows',
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={s.agent.online ? 'green' : 'red'} dot>
                {s.agent.online ? 'Online' : 'Offline'}
              </StatusBadge>
              {s.agent.hostname && <span className="text-xs text-muted">Servidor: {s.agent.hostname}</span>}
              {s.agent.version && <span className="text-xs text-muted">Versão {s.agent.version}</span>}
              {s.agent.online && s.agent.rootAccessible === false && <StatusBadge tone="orange">Pasta inacessível</StatusBadge>}
            </span>,
            s.agent.lastError ? <span className="text-red-600">Último erro: {s.agent.lastError}</span> : undefined,
          )}
          {row(<Clock size={18} />, 'Última sincronização', fmtDateTime(s.lastSyncAt))}
        </div>
        <div className="space-y-5">
          <div className="card px-5 py-1">
            {row(
              <Mail size={18} />,
              'Notificações por e-mail',
              <span className="flex items-center justify-between gap-3">
                <span className="font-semibold">{s.emailNotificationsEnabled ? 'Ativadas' : 'Desativadas'}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.emailNotificationsEnabled}
                  disabled={saving}
                  onClick={toggleEmail}
                  className={`relative h-6 w-11 rounded-full transition-colors ${s.emailNotificationsEnabled ? 'bg-orange-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${s.emailNotificationsEnabled ? 'translate-x-5' : ''}`} />
                </button>
              </span>,
              <span className="flex flex-wrap gap-2">
                <StatusBadge tone={s.smtpConfigured ? 'green' : 'orange'}>SMTP {s.smtpConfigured ? 'configurado' : 'não configurado'}</StatusBadge>
                <StatusBadge tone={s.approvalEmailConfigured ? 'green' : 'orange'}>DP_APPROVAL_EMAIL {s.approvalEmailConfigured ? 'configurado' : 'não configurado'}</StatusBadge>
              </span>,
            )}
          </div>
          <div className="card p-5">
            <h3 className="card-title mb-3 flex items-center gap-2">
              <BellRing size={16} className="text-orange-500" /> Notificações do Windows
            </h3>
            <WindowsNotificationsToggle />
            <p className="mt-3 text-xs text-muted">Preferência deste navegador. O sistema pede a permissão do navegador ao ativar.</p>
          </div>
        </div>
      </div>
    </>
  );
}
