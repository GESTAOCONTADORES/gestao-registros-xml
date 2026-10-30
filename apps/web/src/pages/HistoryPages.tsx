import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import {
  RUN_FILE_STATUS_LABELS,
  RUN_SCOPE_LABELS,
  RUN_STATUS_LABELS,
  describePeriod,
  formatBytes,
  formatCompetence,
  formatDuration,
  type Paginated,
  type RunDTO,
  type RunEventDTO,
  type RunFileDTO,
  type RunFileStatus,
  type RunStatus,
} from '@gestao/shared';
import { download, get } from '../api/client';
import { PageHeader } from '../components/Layout';
import { Pagination } from '../components/Pagination';
import { ProgressBar } from '../components/ImportProgress';
import { RecordDetailModal } from '../components/RecordDetailModal';
import { EmptyState, ErrorState, LoadingState } from '../components/States';
import { FILE_STATUS_TONE, RUN_STATUS_TONE, StatusBadge } from '../components/StatusBadge';
import { useToast } from '../components/Toasts';
import { errorMessage, fmtDateTime, fmtNumber } from '../lib/format';

export function HistoryPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<RunStatus | ''>('');
  const q = useQuery({
    queryKey: ['runs', page, status],
    queryFn: () => get<Paginated<RunDTO>>('/runs', { page, status: status || undefined }),
    placeholderData: (p) => p,
    refetchInterval: 15_000,
  });
  return (
    <>
      <PageHeader title="Histórico" subtitle="Execuções do robô. Clique em uma linha para ver os detalhes." />
      <div className="card">
        <div className="flex items-center gap-2 border-b border-line p-3">
          <label className="label mb-0" htmlFor="h-status">
            Status
          </label>
          <select id="h-status" className="input max-w-xs" value={status} onChange={(e) => { setStatus(e.target.value as RunStatus); setPage(1); }}>
            <option value="">Todos</option>
            {(Object.keys(RUN_STATUS_LABELS) as RunStatus[]).map((s) => (
              <option key={s} value={s}>
                {RUN_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.items.length ? (
          <EmptyState title="Nenhuma execução registrada" message="As pesquisas iniciadas aparecem aqui." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Usuário</th>
                    <th>Empresas</th>
                    <th className="text-right">Encontrados</th>
                    <th className="text-right">Novos</th>
                    <th className="text-right">Existentes</th>
                    <th className="text-right">Erros</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((r) => (
                    <tr key={r.id} className="cursor-pointer" onClick={() => navigate(`/historico/${r.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/historico/${r.id}`)}>
                      <td className="whitespace-nowrap">
                        <span className="block text-sm">{fmtDateTime(r.createdAt)}</span>
                        <span className="block text-xs text-muted">
                          #{r.id} · {describePeriod(r.year, r.month)}
                        </span>
                      </td>
                      <td>{r.requestedByName ?? '—'}</td>
                      <td className="max-w-[260px]">
                        <span className="block truncate text-sm" title={r.companyNames?.join(', ')}>
                          {r.totalCompanies === 1 ? r.companyNames?.[0] : `${fmtNumber(r.totalCompanies)} empresas`}
                        </span>
                        <span className="block text-xs text-muted">{RUN_SCOPE_LABELS[r.scope]}</span>
                      </td>
                      <td className="text-right">{fmtNumber(r.newFiles + r.duplicates + r.errors)}</td>
                      <td className="text-right font-semibold text-emerald-700">{fmtNumber(r.newFiles)}</td>
                      <td className="text-right">{fmtNumber(r.duplicates)}</td>
                      <td className={`text-right ${r.errors ? 'font-semibold text-red-600' : ''}`}>{fmtNumber(r.errors)}</td>
                      <td>
                        <StatusBadge tone={RUN_STATUS_TONE[r.status]} dot>
                          {RUN_STATUS_LABELS[r.status]}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} />
          </>
        )}
      </div>
    </>
  );
}

const COMPANY_STATUS: Record<string, { label: string; tone: 'green' | 'red' | 'orange' | 'gray' | 'blue' }> = {
  PENDING: { label: 'Aguardando', tone: 'gray' },
  RUNNING: { label: 'Processando', tone: 'orange' },
  DONE: { label: 'Concluída', tone: 'green' },
  FOLDER_NOT_FOUND: { label: 'Pasta não encontrada', tone: 'red' },
  ERROR: { label: 'Erro', tone: 'red' },
  CANCELLED: { label: 'Cancelada', tone: 'gray' },
};

export function HistoryDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const [fileStatus, setFileStatus] = useState<RunFileStatus | ''>('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<number | null>(null);
  const run = useQuery({
    queryKey: ['run', id],
    queryFn: () => get<RunEventDTO>(`/runs/${id}`),
    refetchInterval: (q) => (q.state.data && ['QUEUED', 'RUNNING'].includes(q.state.data.run.status) ? 3000 : false),
  });
  const files = useQuery({
    queryKey: ['run-files', id, fileStatus, page],
    queryFn: () => get<Paginated<RunFileDTO>>(`/runs/${id}/files`, { status: fileStatus || undefined, page, pageSize: 50 }),
    placeholderData: (p) => p,
  });
  if (run.isLoading) return <LoadingState />;
  if (run.isError) return <ErrorState error={run.error} onRetry={() => run.refetch()} />;
  const ev = run.data!;
  const r = ev.run;
  const elapsed = r.startedAt ? (r.finishedAt ? Date.parse(r.finishedAt) : Date.now()) - Date.parse(r.startedAt) : NaN;
  const kpis: [string, string, string?][] = [
    ['Empresas analisadas', `${fmtNumber(r.companiesProcessed)}/${fmtNumber(r.totalCompanies)}`],
    ['Arquivos verificados', `${fmtNumber(r.filesChecked)}/${fmtNumber(r.totalFiles)}`],
    ['Encontrados no período', fmtNumber(r.newFiles + r.duplicates + r.errors)],
    ['Novos', fmtNumber(r.newFiles), 'text-emerald-700'],
    ['Já importados', fmtNumber(r.duplicates)],
    ['Erros', fmtNumber(r.errors), r.errors ? 'text-red-600' : undefined],
  ];
  const downloadError = (f: RunFileDTO) =>
    download(`/runs/${r.id}/files/${f.id}/content`, { fallbackName: f.filename }).catch((e) => toast(errorMessage(e), 'error'));

  return (
    <>
      <Link to="/historico" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-navy-800 hover:underline">
        <ArrowLeft size={15} /> Voltar ao histórico
      </Link>
      <PageHeader
        title={`Pesquisa #${r.id}`}
        subtitle={`${describePeriod(r.year, r.month)} · ${RUN_SCOPE_LABELS[r.scope]} · por ${r.requestedByName ?? '—'}`}
        actions={
          <StatusBadge tone={RUN_STATUS_TONE[r.status]} dot>
            {RUN_STATUS_LABELS[r.status]}
          </StatusBadge>
        }
      />
      <div className="card mb-5 p-4">
        <div className="mb-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <p className="text-xs text-muted">Criada em</p>
            <p className="font-semibold">{fmtDateTime(r.createdAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Início</p>
            <p className="font-semibold">{fmtDateTime(r.startedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Término</p>
            <p className="font-semibold">{fmtDateTime(r.finishedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Tempo total</p>
            <p className="font-semibold">{Number.isFinite(elapsed) ? formatDuration(elapsed) : '—'}</p>
          </div>
        </div>
        <ProgressBar value={r.progress} />
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {kpis.map(([k, v, tone]) => (
            <div key={k} className="rounded-lg bg-navy-50 px-3 py-2">
              <p className="text-xs text-muted">{k}</p>
              <p className={`text-lg font-bold ${tone ?? 'text-navy-900'}`}>{v}</p>
            </div>
          ))}
        </div>
        {r.errorMessage && <p className="mt-3 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-700">{r.errorMessage}</p>}
        {r.fullRescan && <p className="mt-2 text-xs text-muted">Verificação completa (cache ignorado).</p>}
      </div>

      <div className="card mb-5">
        <div className="border-b border-line px-4 py-3">
          <h3 className="card-title">Empresas</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Pasta</th>
                <th>Situação</th>
                <th className="text-right">Verificados</th>
                <th className="text-right">Novos</th>
                <th className="text-right">Existentes</th>
                <th className="text-right">Erros</th>
              </tr>
            </thead>
            <tbody>
              {ev.companies.map((c) => (
                <tr key={c.companyId}>
                  <td className="font-semibold text-navy-900">{c.companyName}</td>
                  <td className="font-mono text-xs">{c.folderName}</td>
                  <td>
                    <StatusBadge tone={COMPANY_STATUS[c.status]?.tone}>{COMPANY_STATUS[c.status]?.label ?? c.status}</StatusBadge>
                    {c.message && <span className="block text-xs text-muted">{c.message}</span>}
                  </td>
                  <td className="text-right">{fmtNumber(c.totalFiles)}</td>
                  <td className="text-right text-emerald-700">{fmtNumber(c.newFiles)}</td>
                  <td className="text-right">{fmtNumber(c.duplicates)}</td>
                  <td className={`text-right ${c.errors ? 'font-semibold text-red-600' : ''}`}>{fmtNumber(c.errors)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <h3 className="card-title mr-auto">Arquivos</h3>
          {(['', 'ERROR', 'IMPORTED', 'DUPLICATE'] as const).map((s) => (
            <button key={s} onClick={() => { setFileStatus(s); setPage(1); }} className={`rounded-lg px-3 py-1 text-xs font-semibold ${fileStatus === s ? 'bg-navy-900 text-white' : 'text-navy-800 hover:bg-navy-50'}`}>
              {s ? RUN_FILE_STATUS_LABELS[s] : 'Todos'}
            </button>
          ))}
        </div>
        {files.isLoading ? (
          <LoadingState />
        ) : files.isError ? (
          <ErrorState error={files.error} />
        ) : !files.data?.items.length ? (
          <EmptyState title="Nenhum arquivo" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Arquivo</th>
                    <th>Empresa</th>
                    <th>Competência</th>
                    <th>Tamanho</th>
                    <th>Situação</th>
                    <th className="text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {files.data.items.map((f) => (
                    <tr key={f.id}>
                      <td className="max-w-[320px]">
                        <span className="block truncate font-medium" title={f.relativePath}>
                          {f.filename}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted">{f.relativePath}</span>
                        {f.errorMessage && <span className="block text-xs text-red-600">{f.errorMessage}</span>}
                      </td>
                      <td className="max-w-[200px] truncate text-sm">{f.companyName ?? '—'}</td>
                      <td>{formatCompetence(f.year, f.month)}</td>
                      <td className="text-xs">{f.fileSize != null ? formatBytes(f.fileSize) : '—'}</td>
                      <td>
                        <StatusBadge tone={FILE_STATUS_TONE[f.status]}>{RUN_FILE_STATUS_LABELS[f.status]}</StatusBadge>
                      </td>
                      <td className="text-right">
                        {f.importedFileId && (
                          <button className="btn-outline btn-sm" onClick={() => setView(f.importedFileId)}>
                            Visualizar
                          </button>
                        )}
                        {f.status === 'ERROR' && f.hasContent && (
                          <button className="btn-outline btn-sm" onClick={() => downloadError(f)}>
                            <Download size={13} /> Arquivo
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={files.data.pageSize} total={files.data.total} onChange={setPage} />
          </>
        )}
      </div>
      <RecordDetailModal recordId={view} onClose={() => setView(null)} />
    </>
  );
}
