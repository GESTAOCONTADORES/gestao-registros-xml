import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Archive, Search } from 'lucide-react';
import { describePeriod } from '@gestao/shared';
import { download, get } from '../api/client';
import { useRecords, type PeriodFilters } from '../api/hooks';
import { CompanySelector } from '../components/CompanySelector';
import { FiltersBar } from '../components/FiltersBar';
import { PageHeader } from '../components/Layout';
import { MonthSelector } from '../components/MonthSelector';
import { RecordDetailModal } from '../components/RecordDetailModal';
import { RecordsTable } from '../components/RecordsTable';
import { ErrorState, LoadingState } from '../components/States';
import { useToast } from '../components/Toasts';
import { YearSelector } from '../components/YearSelector';
import { errorMessage, fmtNumber } from '../lib/format';

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function BulkDownload() {
  const toast = useToast();
  const now = new Date();
  const [companyIds, setCompanyIds] = useState<number[]>([]);
  const [year, setYear] = useState<number | undefined>(now.getFullYear());
  const [month, setMonth] = useState<number | undefined>(now.getMonth() + 1);
  const [format, setFormat] = useState<'xml' | 'html' | 'pdf'>('xml');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const name = await download('/records/bulk-download', { method: 'POST', body: { companyIds, year, month: year ? month : undefined, format }, fallbackName: 'GESTAO_XML.zip' });
      toast(`Download iniciado: ${name}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card p-4">
      <h3 className="card-title mb-3 flex items-center gap-2">
        <Archive size={16} className="text-orange-500" /> Download em lote
      </h3>
      <div className="space-y-3">
        <div>
          <span className="label">Empresa</span>
          <CompanySelector value={companyIds} onChange={setCompanyIds} />
        </div>
        <div>
          <label className="label" htmlFor="bd-year">
            Ano
          </label>
          <YearSelector id="bd-year" allowAll value={year} onChange={setYear} />
        </div>
        <div className={year ? '' : 'pointer-events-none opacity-50'}>
          <span className="label">Mês</span>
          <MonthSelector value={month} onChange={setMonth} />
        </div>
        <div>
          <span className="label">Formato</span>
          <div className="grid grid-cols-3 gap-1.5">
            {(['xml', 'html', 'pdf'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)} className={`rounded-lg border px-2 py-2 text-sm font-bold ${format === f ? 'border-navy-900 bg-navy-900 text-white' : 'border-line text-navy-900 hover:border-navy-800'}`}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <button className="btn-primary w-full" disabled={busy} onClick={run}>
          <Archive size={16} /> {busy ? 'Preparando arquivos…' : 'Baixar arquivos'}
        </button>
        <p className="text-xs text-muted">{describePeriod(year, month)} · vários arquivos são entregues em um ZIP.</p>
      </div>
    </div>
  );
}

export function RecordsPage() {
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<PeriodFilters>({
    companyIds: [],
    year: params.get('year') ? Number(params.get('year')) : undefined,
    month: params.get('month') ? Number(params.get('month')) : undefined,
  });
  const [search, setSearch] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<number | null>(null);
  const debounced = useDebounced(search);
  useEffect(() => setPage(1), [filters, debounced, documentType]);
  const types = useQuery({ queryKey: ['document-types'], queryFn: () => get<{ value: string; label: string; count: number }[]>('/records/document-types') });
  const q = useRecords({ ...filters, search: debounced || undefined, documentType: documentType || undefined, page, pageSize: 25 });

  return (
    <>
      <PageHeader title="Registros" subtitle="Consulta dos XML importados. Downloads são registrados na auditoria." />
      <FiltersBar value={filters} onChange={setFilters}>
        <div className="min-w-[220px]">
          <label className="label" htmlFor="r-type">
            Tipo de documento
          </label>
          <select id="r-type" className="input" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
            <option value="">Todos os tipos</option>
            {types.data?.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} ({t.count})
              </option>
            ))}
          </select>
        </div>
      </FiltersBar>
      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[1fr_340px]">
        <div className="card min-w-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
            <div className="relative min-w-[260px] flex-1">
              <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <input
                className="input pl-9"
                placeholder="Pesquisar: empresa, CNPJ, arquivo, trabalhador, CPF, competência, protocolo"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Pesquisar"
              />
            </div>
            <span className="text-sm text-muted">{q.data ? `${fmtNumber(q.data.total)} registro(s)` : ''}</span>
          </div>
          {q.isLoading ? (
            <LoadingState />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <RecordsTable items={q.data?.items ?? []} total={q.data?.total ?? 0} page={page} pageSize={25} onPageChange={setPage} onView={(r) => setView(r.id)} />
          )}
        </div>
        <div>
          <BulkDownload />
        </div>
      </div>
      <RecordDetailModal recordId={view} onClose={() => setView(null)} />
    </>
  );
}
