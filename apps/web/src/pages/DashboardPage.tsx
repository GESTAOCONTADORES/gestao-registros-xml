import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, Building2, Clock4, CopyCheck, FileDown, FolderSearch, Search } from 'lucide-react';
import { RUN_STATUS_LABELS, describePeriod } from '@gestao/shared';
import { useDashboard, useRecords, type PeriodFilters } from '../api/hooks';
import { CompanyBarChart, MonthlyChart } from '../components/Charts';
import { FiltersBar } from '../components/FiltersBar';
import { PageHeader } from '../components/Layout';
import { MetricCard } from '../components/MetricCard';
import { RecordDetailModal } from '../components/RecordDetailModal';
import { RecordsTable } from '../components/RecordsTable';
import { ErrorState, LoadingState } from '../components/States';
import { RUN_STATUS_TONE, StatusBadge } from '../components/StatusBadge';
import { Logo } from '../components/Logo';
import { fmtDateTime, fmtNumber } from '../lib/format';

export function DashboardPage() {
  const now = new Date();
  const [filters, setFilters] = useState<PeriodFilters>({ companyIds: [], year: now.getFullYear(), month: now.getMonth() + 1 });
  const [view, setView] = useState<number | null>(null);
  const q = useDashboard(filters);
  const recent = useRecords({ ...filters, page: 1, pageSize: 10 });
  const d = q.data;
  const periodLabel = describePeriod(filters.year, filters.month);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Visão geral dos registros XML · ${periodLabel}`}
        actions={
          <>
            <div className="mr-2 hidden items-center xl:flex">
              <Logo className="h-8" />
            </div>
            <Link to="/pesquisar" className="btn-primary">
              <FolderSearch size={16} /> Iniciar pesquisa
            </Link>
          </>
        }
      />
      <FiltersBar value={filters} onChange={setFilters} />
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <MetricCard label="Empresas monitoradas" value={fmtNumber(d.monitoredCompanies)} icon={<Building2 size={20} />} hint="Empresas ativas" />
            <MetricCard label={filters.month ? 'XML encontrados no mês' : 'XML encontrados'} value={fmtNumber(d.filesFound)} icon={<Search size={20} />} hint={periodLabel} />
            <MetricCard label="Novos registros importados" value={fmtNumber(d.newFiles)} icon={<FileDown size={20} />} accent="orange" hint={periodLabel} />
            <MetricCard label="Já existentes ignorados" value={fmtNumber(d.duplicates)} icon={<CopyCheck size={20} />} hint="Controle por SHA-256" />
            <MetricCard label="Erros" value={fmtNumber(d.errors)} icon={<AlertOctagon size={20} />} accent={d.errors ? 'red' : 'navy'} hint="Arquivos com problema" />
            <MetricCard
              label="Última execução"
              value={<span className="text-base">{d.lastRun ? fmtDateTime(d.lastRun.finishedAt ?? d.lastRun.createdAt) : '—'}</span>}
              icon={<Clock4 size={20} />}
              hint={
                d.lastRun ? (
                  <Link to={`/historico/${d.lastRun.id}`} className="hover:underline">
                    <StatusBadge tone={RUN_STATUS_TONE[d.lastRun.status]}>{RUN_STATUS_LABELS[d.lastRun.status]}</StatusBadge>
                  </Link>
                ) : (
                  'Nenhuma pesquisa realizada'
                )
              }
            />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-5 2xl:grid-cols-2">
            <CompanyBarChart data={d.byCompany} />
            <MonthlyChart data={d.byMonth} year={filters.year ?? now.getFullYear()} multiCompany={filters.companyIds.length !== 1} />
          </div>
        </>
      )}
      <div className="card mt-5">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="card-title">Registros recentes</h3>
          <Link to="/registros" className="text-sm font-semibold text-orange-600 hover:underline">
            Ver todos
          </Link>
        </div>
        {recent.isLoading ? <LoadingState /> : recent.isError ? <ErrorState error={recent.error} /> : <RecordsTable items={recent.data?.items ?? []} onView={(r) => setView(r.id)} compact />}
      </div>
      <RecordDetailModal recordId={view} onClose={() => setView(null)} />
    </>
  );
}
