import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, FileBarChart2, FileDown, HardDrive, RefreshCw, XCircle } from 'lucide-react';
import type { Paginated, ReportDTO } from '@gestao/shared';
import { download, get, post } from '../api/client';
import type { PeriodFilters } from '../api/hooks';
import { FiltersBar } from '../components/FiltersBar';
import { PageHeader } from '../components/Layout';
import { Logo } from '../components/Logo';
import { Pagination } from '../components/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toasts';
import { errorMessage, fmtDateTime, fmtNumber } from '../lib/format';

function DriveStatus({ r, onRetry }: { r: ReportDTO; onRetry: () => void }) {
  if (r.driveStatus === 'SAVED')
    return (
      <span className="flex flex-col gap-0.5">
        <StatusBadge tone="green">
          <CheckCircle2 size={12} /> Salvo no Drive
        </StatusBadge>
        {r.drivePath && <span className="max-w-[340px] truncate font-mono text-[11px] text-muted" title={r.drivePath}>{r.drivePath}</span>}
      </span>
    );
  if (r.driveStatus === 'FAILED')
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusBadge tone="red">
          <XCircle size={12} /> Falha ao salvar
        </StatusBadge>
        <button className="btn-outline btn-sm" onClick={onRetry} title={r.driveError ?? undefined}>
          <RefreshCw size={12} /> Tentar novamente
        </button>
      </span>
    );
  return (
    <StatusBadge tone="blue">
      <Clock size={12} /> Aguardando o agente gravar
    </StatusBadge>
  );
}

export function ReportsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const now = new Date();
  const [filters, setFilters] = useState<PeriodFilters>({ companyIds: [], year: now.getFullYear(), month: now.getMonth() + 1 });
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<ReportDTO | null>(null);
  const list = useQuery({
    queryKey: ['reports', page],
    queryFn: () => get<Paginated<ReportDTO>>('/reports', { page }),
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.driveStatus === 'PENDING') ? 5000 : false),
  });
  const current = last ? list.data?.items.find((r) => r.id === last.id) ?? last : null;

  const generate = async () => {
    setBusy(true);
    try {
      const r = await post<ReportDTO>('/reports', filters);
      setLast(r);
      toast('Relatório gerado. Uma cópia será salva em RELATORIOS ROBO.');
      void qc.invalidateQueries({ queryKey: ['reports'] });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const pdf = (r: ReportDTO) => download(`/reports/${r.id}/pdf`, { fallbackName: r.filename }).catch((e) => toast(errorMessage(e), 'error'));
  const retry = async (r: ReportDTO) => {
    try {
      await post(`/reports/${r.id}/save-to-drive`);
      toast('Nova tentativa de gravação solicitada.', 'info');
      void qc.invalidateQueries({ queryKey: ['reports'] });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <>
      <PageHeader title="Relatórios" subtitle="Relatório de processamento em PDF (A4, padrão de apresentação ABNT)." actions={<Logo className="h-8" />} />
      <FiltersBar value={filters} onChange={setFilters} dateLabel="Data da execução">
        <button className="btn-primary" onClick={generate} disabled={busy}>
          <FileBarChart2 size={16} /> {busy ? 'Gerando…' : 'Gerar relatório'}
        </button>
      </FiltersBar>

      {current && (
        <div className="card mb-5 border-l-4 border-l-orange-500 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-muted uppercase">Relatório gerado</p>
              <p className="font-mono text-sm font-semibold text-navy-900">{current.filename}</p>
              <p className="text-sm text-muted">{current.summary.periodLabel}</p>
            </div>
            <button className="btn-primary" onClick={() => pdf(current)}>
              <FileDown size={16} /> Baixar PDF
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            {[
              ['Empresas analisadas', current.summary.companiesAnalyzed],
              ['Arquivos encontrados', current.summary.filesFound],
              ['Novos registros', current.summary.newFiles],
              ['Já existentes', current.summary.duplicates],
              ['Com erro', current.summary.errors],
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-lg bg-navy-50 px-3 py-2">
                <p className="text-xs text-muted">{k}</p>
                <p className="text-lg font-bold text-navy-900">{fmtNumber(v as number)}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-sm">
            <HardDrive size={15} className="text-navy-800" />
            <DriveStatus r={current} onRetry={() => retry(current)} />
          </div>
        </div>
      )}

      <div className="card">
        <div className="border-b border-line px-4 py-3">
          <h3 className="card-title">Relatórios emitidos</h3>
        </div>
        {list.isLoading ? (
          <LoadingState />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data?.items.length ? (
          <EmptyState title="Nenhum relatório emitido" message="Selecione os filtros e clique em Gerar relatório." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Arquivo</th>
                    <th>Período</th>
                    <th>Emitido por</th>
                    <th className="text-right">Novos</th>
                    <th>Drive</th>
                    <th className="text-right">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((r) => (
                    <tr key={r.id}>
                      <td className="text-xs whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                      <td className="max-w-[280px] truncate font-mono text-xs" title={r.filename}>
                        {r.filename}
                      </td>
                      <td className="text-xs">{r.summary.periodLabel}</td>
                      <td className="text-xs">{r.requestedByName ?? '—'}</td>
                      <td className="text-right">{fmtNumber(r.summary.newFiles)}</td>
                      <td>
                        <DriveStatus r={r} onRetry={() => retry(r)} />
                      </td>
                      <td className="text-right">
                        <button className="btn-outline btn-sm" onClick={() => pdf(r)}>
                          <FileDown size={14} /> Baixar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />
          </>
        )}
      </div>
    </>
  );
}
