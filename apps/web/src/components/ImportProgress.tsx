import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, StopCircle } from 'lucide-react';
import { RUN_STATUS_LABELS, describePeriod } from '@gestao/shared';
import { post } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { fmtNumber } from '../lib/format';
import { useActiveRun } from '../runs/ActiveRunProvider';
import { ConfirmDialog } from './ConfirmDialog';
import { useToast } from './Toasts';

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2 text-xs font-semibold text-navy-900">
      <span>0%</span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-navy-100" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-orange-400 transition-[width] duration-500" style={{ width: `${v}%` }} />
      </div>
      <span>100%</span>
    </div>
  );
}

/** Painel flutuante "Processando arquivos" com progresso real vindo do agente. */
export function ImportProgress() {
  const { active, minimized, setMinimized } = useActiveRun();
  const { isMaster } = useAuth();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  if (!active) return null;
  const { run } = active;
  const queued = run.status === 'QUEUED';

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-xl hover:bg-navy-800"
      >
        <Loader2 size={16} className="animate-spin text-orange-400" />
        Processando… {Math.round(run.progress)}%
        <ChevronUp size={16} />
      </button>
    );
  }

  const stat = (label: string, value: string, tone = 'text-navy-900') => (
    <div className="rounded-lg bg-navy-50 px-3 py-2">
      <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className={`text-base font-bold ${tone}`}>{value}</p>
    </div>
  );

  return (
    <div className="card fixed right-4 bottom-4 z-40 w-[min(440px,calc(100vw-2rem))] overflow-hidden shadow-2xl" role="status" aria-live="polite">
      <div className="flex items-center justify-between bg-navy-900 px-4 py-2.5 text-white">
        <div className="flex items-center gap-2">
          <Loader2 size={16} className="animate-spin text-orange-400" />
          <span className="text-sm font-bold">Processando arquivos</span>
          <span className="text-xs text-navy-100">#{run.id}</span>
        </div>
        <button className="rounded p-1 hover:bg-navy-800" onClick={() => setMinimized(true)} aria-label="Minimizar">
          <ChevronDown size={18} />
        </button>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted">{describePeriod(run.year, run.month)}</span>
          <span className="text-2xl font-bold text-orange-500">{Math.round(run.progress)}%</span>
        </div>
        <ProgressBar value={run.progress} />
        <p className="truncate text-sm">
          <span className="text-muted">Empresa atual: </span>
          <span className="font-semibold text-navy-900">{queued ? 'Aguardando o agente iniciar…' : run.currentCompanyName ?? '—'}</span>
        </p>
        <div className="grid grid-cols-3 gap-2">
          {stat('Empresas', `${fmtNumber(run.companiesProcessed)}/${fmtNumber(run.totalCompanies)}`)}
          {stat('Verificados', `${fmtNumber(run.filesChecked)}/${fmtNumber(run.totalFiles)}`)}
          {stat('Novos', fmtNumber(run.newFiles), 'text-emerald-700')}
          {stat('Já importados', fmtNumber(run.duplicates))}
          {stat('Erros', fmtNumber(run.errors), run.errors ? 'text-red-600' : 'text-navy-900')}
          {stat('Situação', run.cancelRequested ? 'Cancelando…' : RUN_STATUS_LABELS[run.status], 'text-navy-900 text-sm')}
        </div>
        <p className="text-xs text-muted">Você pode continuar usando o sistema ou fechar o navegador: o processamento continua no Agente Windows.</p>
        {isMaster && (
          <button className="btn-outline w-full border-red-200 text-red-700 hover:border-red-400 hover:bg-red-50" disabled={run.cancelRequested} onClick={() => setConfirm(true)}>
            <StopCircle size={16} />
            {run.cancelRequested ? 'Cancelamento solicitado' : 'Cancelar processamento'}
          </button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        danger
        title="Cancelar processamento"
        message="O agente encerrará com segurança após o arquivo que estiver sendo processado. O que já foi importado será mantido."
        confirmLabel="Cancelar processamento"
        cancelLabel="Voltar"
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          await post(`/runs/${run.id}/cancel`);
          toast('Cancelamento solicitado ao agente.', 'info');
        }}
      />
    </div>
  );
}
