import { useEffect, useRef, useState } from 'react';
import { BellRing, ChevronDown, KeyRound, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useWindowsNotifications } from '../lib/browserNotifications';
import { errorMessage } from '../lib/format';
import { Modal } from './Modal';
import { useToast } from './Toasts';

export function WindowsNotificationsToggle() {
  const { enabled, supported, toggle } = useWindowsNotifications();
  const toast = useToast();
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block text-sm font-medium text-ink">Notificações do Windows</span>
        <span className="block text-xs text-muted">{supported ? (enabled ? 'Ativadas' : 'Desativadas') : 'Não suportado neste navegador'}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={!supported}
        onClick={async () => {
          const r = await toggle(!enabled);
          if (!r.ok && r.message) toast(r.message, 'error');
          else if (!enabled) toast('Notificações do Windows ativadas.');
        }}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${enabled ? 'bg-orange-500' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.newPassword.length < 6) return setError('A nova senha deve ter no mínimo 6 caracteres.');
    if (form.newPassword !== form.confirmPassword) return setError('As senhas não conferem.');
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: form });
      toast('Senha alterada com sucesso.');
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof typeof form, label: string) => (
    <div>
      <label className="label" htmlFor={`cp-${key}`}>
        {label}
      </label>
      <input id={`cp-${key}`} type="password" className="input" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required autoComplete={key === 'currentPassword' ? 'current-password' : 'new-password'} />
    </div>
  );
  return (
    <Modal open={open} onClose={onClose} title="Alterar senha" size="sm">
      <form onSubmit={submit} className="space-y-3">
        {field('currentPassword', 'Senha atual')}
        {field('newPassword', 'Nova senha (mínimo 6 caracteres)')}
        {field('confirmPassword', 'Confirmar nova senha')}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Identificação "Nome Sobrenome / Setor" + perfil, com menu do usuário. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  if (!user) return null;
  const name = `${user.firstName} ${user.lastName}`.trim();
  const initials = (user.firstName[0] ?? '') + (user.lastName[0] ?? '');
  return (
    <div className="relative" ref={ref}>
      <button className="flex items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-navy-50" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-white uppercase">{initials}</span>
        <span className="hidden leading-tight md:block">
          <span className="block text-sm font-semibold text-navy-900">
            {name} / {user.department}
          </span>
          <span className={`block text-xs ${user.role === 'MASTER' ? 'font-bold text-orange-500' : 'text-muted'}`}>{user.role === 'MASTER' ? 'Master' : 'Usuário'}</span>
        </span>
        <ChevronDown size={16} className="text-muted" />
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-72 overflow-hidden shadow-xl" role="menu">
          <div className="border-b border-line px-4 py-3 md:hidden">
            <p className="text-sm font-semibold text-navy-900">
              {name} / {user.department}
            </p>
            <p className="text-xs text-muted">{user.role === 'MASTER' ? 'Master' : 'Usuário'}</p>
          </div>
          <div className="border-b border-line px-4 py-2 text-xs text-muted">
            Identificador: <span className="font-mono text-ink">{user.username}</span>
          </div>
          <button className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-navy-50" onClick={() => { setPwd(true); setOpen(false); }} role="menuitem">
            <KeyRound size={16} className="text-navy-800" /> Alterar senha
          </button>
          <div className="border-y border-line px-4 py-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted uppercase">
              <BellRing size={14} /> Navegador
            </div>
            <WindowsNotificationsToggle />
          </div>
          <button
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-700 hover:bg-red-50"
            role="menuitem"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            <LogOut size={16} /> Sair
          </button>
        </div>
      )}
      <ChangePasswordModal open={pwd} onClose={() => setPwd(false)} />
    </div>
  );
}
