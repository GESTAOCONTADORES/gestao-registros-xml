import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { RUN_STATUS_LABELS, describePeriod, formatDuration } from '@gestao/shared';
import { fmtNumber } from '../lib/format';
import { useActiveRun } from '../runs/ActiveRunProvider';
import { Modal } from './Modal';

/** Modal "Pesquisa concluída" (Seção 41). */
export function ImportSummary() {
  const { finished, dismissSummary } = useActiveRun();
  const navigate = useNavigate();
  if (!finished) return null;
  const r = finished.run;
  const elapsed = r.startedAt && r.finishedAt ? Date.parse(r.finishedAt) - Date.parse(r.startedAt) : NaN;
  const ok = r.status === 'COMPLETED';
  const failed = r.status === 'FAILED' || r.status === 'CANCELLED';
  const Icon = ok ? CheckCircle2 : failed ? XCircle : AlertTriangle;
  const items: [string, string, string?][] = [
    ['Empresas analisadas', `${fmtNumber(r.companiesProcessed)} de ${fmtNumber(r.totalCompanies)}`],
    ['Arquivos localizados', fmtNumber(r.newFiles + r.duplicates + r.errors)],
    ['Novos registros importados', fmtNumber(r.newFiles), 'text-emerald-700'],
    ['Arquivos já existentes', fmtNumber(r.duplicates)],
    ['Erros', fmtNumber(r.errors), r.errors ? 'text-red-600' : undefined],
    ['Tempo total', Number.isFinite(elapsed) ? formatDuration(elapsed) : '—'],
  ];
  const go = (to: string) => {
    dismissSummary();
    navigate(to);
  };
  return (
    <Modal
      open
      onClose={dismissSummary}
      title={r.status === 'CANCELLED' ? 'Pesquisa cancelada' : r.status === 'FAILED' ? 'Pesquisa interrompida' : 'Pesquisa concluída'}
      footer={
        <>
          <button className="btn-outline" onClick={() => go(`/registros${r.year ? `?year=${r.year}${r.month ? `&month=${r.month}` : ''}` : ''}`)}>
            Ver registros
          </button>
          <button className="btn-outline" onClick={() => go(`/historico/${r.id}`)}>
            Ver relatório
          </button>
          <button className="btn-primary" onClick={dismissSummary}>
            Fechar
          </button>
        </>
      }
    >
      <div className="mb-4 flex items-center gap-3">
        <Icon size={34} className={ok ? 'text-emerald-600' : failed ? 'text-red-600' : 'text-orange-500'} />
        <div>
          <p className="font-bold text-navy-900">{RUN_STATUS_LABELS[r.status]}</p>
          <p className="text-sm text-muted">
            Pesquisa #{r.id} · {describePeriod(r.year, r.month)}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        {items.map(([k, v, tone]) => (
          <div key={k} className="rounded-lg border border-line px-3 py-2">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className={`text-lg font-bold ${tone ?? 'text-navy-900'}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {r.errorMessage && <p className="mt-3 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-600">{r.errorMessage}</p>}
    </Modal>
  );
}
