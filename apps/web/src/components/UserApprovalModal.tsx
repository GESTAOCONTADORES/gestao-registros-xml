import { useState } from 'react';
import { Ban, Check, RotateCcw, X } from 'lucide-react';
import { ROLE_LABELS, USER_STATUS_LABELS, type UserDTO } from '@gestao/shared';
import { post } from '../api/client';
import { errorMessage, fmtDateTime } from '../lib/format';
import { Modal } from './Modal';
import { StatusBadge, USER_STATUS_TONE } from './StatusBadge';

type Action = 'approve' | 'reject' | 'block' | 'reactivate';

const ACTIONS: Record<Action, { label: string; className: string; icon: typeof Check; allowed: UserDTO['status'][] }> = {
  approve: { label: 'Aprovar', className: 'btn-primary', icon: Check, allowed: ['PENDING', 'REJECTED'] },
  reject: { label: 'Rejeitar', className: 'btn-outline', icon: X, allowed: ['PENDING'] },
  block: { label: 'Bloquear', className: 'btn-danger', icon: Ban, allowed: ['ACTIVE', 'PENDING'] },
  reactivate: { label: 'Reativar', className: 'btn-navy', icon: RotateCcw, allowed: ['BLOCKED', 'REJECTED'] },
};

export function availableActions(u: UserDTO): Action[] {
  return (Object.keys(ACTIONS) as Action[]).filter((a) => ACTIONS[a].allowed.includes(u.status) && !(a === 'reactivate' && u.status === 'REJECTED'));
}

/** Aprovação de acessos: Aprovar / Rejeitar / Bloquear / Reativar. */
export function UserApprovalModal({ user, onClose, onDone }: { user: UserDTO | null; onClose: () => void; onDone: (u: UserDTO) => void }) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;
  const act = async (a: Action) => {
    setBusy(a);
    setError(null);
    try {
      const u = await post<UserDTO>(`/users/${user.id}/${a}`);
      onDone(u);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Solicitação de acesso"
      footer={availableActions(user).map((a) => {
        const A = ACTIONS[a];
        return (
          <button key={a} className={A.className} disabled={!!busy} onClick={() => act(a)}>
            <A.icon size={16} /> {busy === a ? 'Aguarde…' : A.label}
          </button>
        );
      })}
    >
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="col-span-2 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-900 text-lg font-bold text-white uppercase">
            {user.firstName[0]}
            {user.lastName[0]}
          </span>
          <div>
            <p className="font-bold text-navy-900">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-muted">{user.department}</p>
          </div>
        </div>
        <div>
          <dt className="text-xs text-muted">Identificador de acesso</dt>
          <dd className="font-mono">{user.username}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Situação</dt>
          <dd>
            <StatusBadge tone={USER_STATUS_TONE[user.status]}>{USER_STATUS_LABELS[user.status]}</StatusBadge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Perfil</dt>
          <dd>{ROLE_LABELS[user.role]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Solicitado em</dt>
          <dd>{fmtDateTime(user.createdAt)}</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-muted">Usuários só acessam o sistema depois de aprovados. Usuários aprovados recebem o perfil "Usuário"; para torná-lo Master use "Editar".</p>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
}
