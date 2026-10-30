import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Trash2, X } from 'lucide-react';
import type { NotificationDTO } from '@gestao/shared';
import { del, post } from '../api/client';
import { qk, useNotifications, useUnreadCount } from '../api/hooks';
import { relativeTime, fmtDateTime } from '../lib/format';
import { EmptyState, ErrorState, LoadingState } from './States';

const TYPE_COLOR: Record<string, string> = {
  SUCCESS: 'bg-emerald-500',
  ERROR: 'bg-red-500',
  WARNING: 'bg-orange-500',
  ACCESS_REQUEST: 'bg-orange-500',
  REPORT: 'bg-navy-800',
  RUN: 'bg-orange-500',
  INFO: 'bg-navy-800',
};

/** Lista de notificações com todas as ações (usada no painel lateral e na página). */
export function NotificationCenter({ onNavigate }: { onNavigate?: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useNotifications();
  const refresh = () => qc.invalidateQueries({ queryKey: qk.notifications });
  const m = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });
  const items = q.data?.items ?? [];
  const open = (n: NotificationDTO) => {
    if (!n.isRead) m.mutate(() => post(`/notifications/${n.id}/read`));
    if (n.link) {
      onNavigate?.();
      navigate(n.link);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2">
        <button className="btn-outline btn-sm" disabled={!q.data?.unread} onClick={() => m.mutate(() => post('/notifications/read-all'))}>
          <CheckCheck size={14} /> Marcar todas como lidas
        </button>
        <button className="btn-outline btn-sm" disabled={!items.some((i) => i.isRead)} onClick={() => m.mutate(() => del('/notifications/read'))}>
          Excluir notificações lidas
        </button>
        <button className="btn-outline btn-sm text-red-700" disabled={!items.length} onClick={() => m.mutate(() => del('/notifications'))}>
          Limpar notificações
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {q.isLoading && <LoadingState />}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {!q.isLoading && !items.length && <EmptyState title="Nenhuma notificação" message="As atividades do robô aparecem aqui." />}
        <ul>
          {items.map((n) => (
            <li key={n.id} className={`group border-b border-line px-4 py-3 ${n.isRead ? 'bg-white' : 'border-l-4 border-l-orange-500 bg-orange-50/60'}`}>
              <div className="flex items-start gap-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TYPE_COLOR[n.type] ?? 'bg-navy-800'}`} />
                <button className="min-w-0 flex-1 text-left" onClick={() => open(n)}>
                  <p className={`text-sm ${n.isRead ? 'font-medium text-ink' : 'font-bold text-navy-900'}`}>{n.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{n.message}</p>
                  <p className="mt-1 text-[11px] text-slate-400" title={fmtDateTime(n.createdAt)}>
                    {relativeTime(n.createdAt)}
                  </p>
                </button>
              </div>
              <div className="mt-1.5 flex justify-end gap-1">
                {!n.isRead && (
                  <button className="btn-ghost btn-sm" onClick={() => m.mutate(() => post(`/notifications/${n.id}/read`))}>
                    Marcar como lida
                  </button>
                )}
                <button className="btn-ghost btn-sm text-red-700" onClick={() => m.mutate(() => del(`/notifications/${n.id}`))} aria-label="Excluir notificação">
                  <Trash2 size={13} /> Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Sino no canto superior direito; abre o painel lateral. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data } = useUnreadCount();
  const unread = data?.unread ?? 0;
  useEffect(() => {
    if (open) void qc.invalidateQueries({ queryKey: qk.notifications });
  }, [open, qc]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button className="relative rounded-lg p-2 text-navy-900 hover:bg-navy-50" onClick={() => setOpen(true)} aria-label={`Notificações${unread ? ` (${unread} não lidas)` : ''}`}>
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open &&
        createPortal(
        <div className="fixed inset-0 z-50 flex justify-end bg-navy-950/30" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl" role="dialog" aria-label="Central de notificações">
            <div className="flex items-center justify-between bg-navy-900 px-4 py-3 text-white">
              <div>
                <p className="font-bold">Central de notificações</p>
                <p className="text-xs text-navy-100">{unread ? `${unread} não lida(s)` : 'Tudo em dia'}</p>
              </div>
              <div className="flex items-center gap-1">
                <Link to="/notificacoes" className="rounded px-2 py-1 text-xs hover:bg-navy-800" onClick={() => setOpen(false)}>
                  Ver todas
                </Link>
                <button className="rounded p-1 hover:bg-navy-800" onClick={() => setOpen(false)} aria-label="Fechar">
                  <X size={18} />
                </button>
              </div>
            </div>
            <NotificationCenter onNavigate={() => setOpen(false)} />
          </aside>
        </div>,
          document.body,
        )}
    </>
  );
}
