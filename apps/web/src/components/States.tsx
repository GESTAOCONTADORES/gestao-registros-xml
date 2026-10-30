import type { ReactNode } from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';
import { errorMessage } from '../lib/format';

export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted" role="status">
      <Loader2 className="animate-spin text-orange-500" size={20} />
      {label}
    </div>
  );
}

export function EmptyState({ title = 'Nada por aqui ainda', message, action }: { title?: string; message?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div className="rounded-full bg-navy-50 p-3 text-navy-800">
        <Inbox size={24} />
      </div>
      <p className="font-semibold text-navy-900">{title}</p>
      {message && <p className="max-w-md text-sm text-muted">{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center" role="alert">
      <AlertCircle className="text-red-600" size={26} />
      <p className="font-semibold text-navy-900">Não foi possível carregar</p>
      <p className="max-w-md text-sm text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <button className="btn-outline btn-sm mt-1" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}
