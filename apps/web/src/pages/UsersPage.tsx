import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, KeyRound, Pencil, Plus, RotateCcw, Search, X } from 'lucide-react';
import { ROLE_LABELS, USER_STATUS_LABELS, type Role, type UserDTO, type UserStatus } from '@gestao/shared';
import { get, patch, post } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PageHeader } from '../components/Layout';
import { Modal } from '../components/Modal';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { StatusBadge, USER_STATUS_TONE } from '../components/StatusBadge';
import { useToast } from '../components/Toasts';
import { UserApprovalModal, availableActions } from '../components/UserApprovalModal';
import { errorMessage, fmtDateTime } from '../lib/format';

type Tab = UserStatus | 'ALL';

function UserFormModal({ user, open, onClose, onSaved }: { user: UserDTO | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ firstName: '', lastName: '', department: '', role: 'USER' as Role, password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setForm(user ? { firstName: user.firstName, lastName: user.lastName, department: user.department, role: user.role, password: '' } : { firstName: '', lastName: '', department: '', role: 'USER', password: '' });
    setError(null);
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user && form.password.length < 6) return setError('A senha deve ter no mínimo 6 caracteres.');
    setBusy(true);
    setError(null);
    try {
      if (user) await patch(`/users/${user.id}`, { firstName: form.firstName, lastName: form.lastName, department: form.department, role: form.role });
      else await post('/users', form);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const input = (k: 'firstName' | 'lastName' | 'department' | 'password', label: string, type = 'text') => (
    <div>
      <label className="label" htmlFor={`uf-${k}`}>
        {label}
      </label>
      <input id={`uf-${k}`} type={type} className="input" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} required autoComplete={type === 'password' ? 'new-password' : 'off'} />
    </div>
  );
  return (
    <Modal open={open} onClose={onClose} title={user ? 'Editar usuário' : 'Novo usuário'} persistent={busy}>
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        {input('firstName', 'Nome')}
        {input('lastName', 'Sobrenome')}
        <div className="col-span-2">{input('department', 'Setor')}</div>
        <div className={user ? 'col-span-2' : ''}>
          <label className="label" htmlFor="uf-role">
            Perfil
          </label>
          <select id="uf-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="USER">Usuário</option>
            <option value="MASTER">Master</option>
          </select>
        </div>
        {!user && input('password', 'Senha inicial', 'password')}
        {!user && <p className="col-span-2 text-xs text-muted">O identificador de acesso é criado automaticamente (ex.: nome.sobrenome). Usuários criados pelo Master já ficam ativos.</p>}
        {error && <p className="col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="col-span-2 flex justify-end gap-2 pt-1">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserDTO | null; onClose: () => void }) {
  const toast = useToast();
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.length < 6) return setError('A senha deve ter no mínimo 6 caracteres.');
    try {
      await post(`/users/${user.id}/reset-password`, { newPassword: pwd });
      toast(`Senha de ${user.firstName} redefinida.`);
      setPwd('');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal open onClose={onClose} title={`Redefinir senha — ${user.firstName} ${user.lastName}`} size="sm">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="rp">
            Nova senha
          </label>
          <input id="rp" type="password" className="input" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" />
        </div>
        <p className="text-xs text-muted">As sessões abertas do usuário serão encerradas.</p>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn-primary">Redefinir</button>
        </div>
      </form>
    </Modal>
  );
}

const ICONS = { approve: Check, reject: X, block: Ban, reactivate: RotateCcw };
const LABELS = { approve: 'Aprovar', reject: 'Rejeitar', block: 'Bloquear', reactivate: 'Reativar' };

export function UsersPage() {
  const [params] = useSearchParams();
  const { user: me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>((params.get('status') as UserStatus) ?? 'ALL');
  const [search, setSearch] = useState('');
  const [approval, setApproval] = useState<UserDTO | null>(null);
  const [form, setForm] = useState<{ open: boolean; user: UserDTO | null }>({ open: false, user: null });
  const [reset, setReset] = useState<UserDTO | null>(null);
  const [confirm, setConfirm] = useState<{ user: UserDTO; action: keyof typeof LABELS } | null>(null);
  const q = useQuery({
    queryKey: ['users', tab, search],
    queryFn: () => get<{ items: UserDTO[]; counts: Record<string, number> }>('/users', { status: tab === 'ALL' ? undefined : tab, search: search || undefined }),
    placeholderData: (p) => p,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const counts = q.data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const tabs: Tab[] = ['ALL', 'PENDING', 'ACTIVE', 'BLOCKED', 'REJECTED'];

  return (
    <>
      <PageHeader
        title="Usuários"
        subtitle="Aprovação de acessos e gestão de perfis."
        actions={
          <button className="btn-primary" onClick={() => setForm({ open: true, user: null })}>
            <Plus size={16} /> Novo usuário
          </button>
        }
      />
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t ? 'bg-navy-900 text-white' : 'text-navy-800 hover:bg-navy-50'}`}>
              {t === 'ALL' ? 'Todos' : USER_STATUS_LABELS[t]}{' '}
              <span className={`ml-1 rounded-full px-1.5 text-xs ${t === 'PENDING' && counts.PENDING ? 'bg-orange-500 text-white' : tab === t ? 'bg-white/20' : 'bg-navy-50'}`}>
                {t === 'ALL' ? total : counts[t] ?? 0}
              </span>
            </button>
          ))}
          <div className="relative ml-auto min-w-[220px]">
            <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Buscar nome, setor ou identificador" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar usuário" />
          </div>
        </div>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState title="Nenhum usuário nesta situação" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Identificador</th>
                  <th>Setor</th>
                  <th>Perfil</th>
                  <th>Situação</th>
                  <th>Cadastro</th>
                  <th>Último acesso</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((u) => (
                  <tr key={u.id} className={u.status === 'PENDING' ? 'bg-orange-50/50' : ''}>
                    <td className="font-semibold text-navy-900">
                      {u.firstName} {u.lastName}
                    </td>
                    <td className="font-mono text-xs">{u.username}</td>
                    <td>{u.department}</td>
                    <td>{u.role === 'MASTER' ? <StatusBadge tone="orange">Master</StatusBadge> : ROLE_LABELS[u.role]}</td>
                    <td>
                      <StatusBadge tone={USER_STATUS_TONE[u.status]} dot>
                        {USER_STATUS_LABELS[u.status]}
                      </StatusBadge>
                    </td>
                    <td className="text-xs whitespace-nowrap">{fmtDateTime(u.createdAt)}</td>
                    <td className="text-xs whitespace-nowrap">{fmtDateTime(u.lastLoginAt)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {u.status === 'PENDING' ? (
                          <button className="btn-primary btn-sm" onClick={() => setApproval(u)}>
                            Analisar
                          </button>
                        ) : (
                          u.id !== me?.id &&
                          availableActions(u).map((a) => {
                            const I = ICONS[a];
                            return (
                              <button key={a} className={`btn-outline btn-sm ${a === 'block' ? 'text-red-700' : ''}`} onClick={() => setConfirm({ user: u, action: a })}>
                                <I size={13} /> {LABELS[a]}
                              </button>
                            );
                          })
                        )}
                        <button className="btn-outline btn-sm" onClick={() => setForm({ open: true, user: u })}>
                          <Pencil size={13} /> Editar
                        </button>
                        <button className="btn-outline btn-sm" onClick={() => setReset(u)} title="Redefinir senha">
                          <KeyRound size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <UserApprovalModal
        user={approval}
        onClose={() => setApproval(null)}
        onDone={(u) => {
          toast(`${u.firstName} ${u.lastName}: ${USER_STATUS_LABELS[u.status]}.`);
          void refresh();
        }}
      />
      <UserFormModal
        open={form.open}
        user={form.user}
        onClose={() => setForm({ open: false, user: null })}
        onSaved={() => {
          toast(form.user ? 'Usuário atualizado.' : 'Usuário cadastrado.');
          void refresh();
        }}
      />
      <ResetPasswordModal user={reset} onClose={() => setReset(null)} />
      {confirm && (
        <ConfirmDialog
          open
          danger={confirm.action === 'block'}
          title={`${LABELS[confirm.action]} usuário`}
          message={
            <>
              Confirma <b>{LABELS[confirm.action].toLowerCase()}</b> o acesso de{' '}
              <b>
                {confirm.user.firstName} {confirm.user.lastName}
              </b>
              ?{confirm.action === 'block' && ' As sessões abertas serão encerradas imediatamente.'}
            </>
          }
          confirmLabel={LABELS[confirm.action]}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await post(`/users/${confirm.user.id}/${confirm.action}`);
            toast('Situação do usuário atualizada.');
            void refresh();
          }}
        />
      )}
    </>
  );
}
