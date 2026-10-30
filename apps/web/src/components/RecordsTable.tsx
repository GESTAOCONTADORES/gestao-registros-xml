import { useState } from 'react';
import { Eye, FileCode2, FileText, Globe } from 'lucide-react';
import { formatCompetence, type RecordDTO } from '@gestao/shared';
import { download } from '../api/client';
import { errorMessage, fmtDateTime } from '../lib/format';
import { Pagination } from './Pagination';
import { EmptyState } from './States';
import { StatusBadge } from './StatusBadge';
import { useToast } from './Toasts';

export type DownloadFormat = 'xml' | 'html' | 'pdf';

export function useRecordDownload() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (r: Pick<RecordDTO, 'id' | 'filename'>, format: DownloadFormat) => {
    const key = `${r.id}:${format}`;
    setBusy(key);
    try {
      await download(`/records/${r.id}/${format}`, { fallbackName: `${r.filename.replace(/\.xml$/i, '')}.${format}` });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };
  return { download: run, busy };
}

interface RecordsTableProps {
  items: RecordDTO[];
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (p: number) => void;
  onView: (r: RecordDTO) => void;
  compact?: boolean;
}

export function RecordsTable({ items, total, page, pageSize, onPageChange, onView, compact }: RecordsTableProps) {
  const { download: dl, busy } = useRecordDownload();
  if (!items.length) return <EmptyState title="Nenhum registro encontrado" message="Altere os filtros ou inicie uma pesquisa de arquivos." />;
  const action = (r: RecordDTO, f: DownloadFormat, Icon: typeof FileCode2, label: string) => (
    <button
      className="btn-outline btn-sm"
      onClick={() => dl(r, f)}
      disabled={busy === `${r.id}:${f}`}
      title={`Baixar ${label}`}
      aria-label={`Baixar ${label} de ${r.filename}`}
    >
      <Icon size={13} className="hidden 2xl:inline" />
      {label}
    </button>
  );
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Arquivo</th>
              <th>Tipo</th>
              <th>Competência</th>
              <th>Data importação</th>
              <th>Status</th>
              <th className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td className="max-w-[220px]">
                  <span className="block truncate font-medium text-navy-900" title={r.companyName}>
                    {r.companyName}
                  </span>
                </td>
                <td className="max-w-[240px]">
                  <span className="block truncate" title={r.filename}>
                    {r.filename}
                  </span>
                  {!compact && r.workerName && <span className="block truncate text-xs text-muted">{r.workerName}</span>}
                </td>
                <td className="max-w-[180px]">
                  <span className="block truncate text-xs" title={r.documentTypeLabel ?? ''}>
                    {r.documentTypeLabel ?? r.documentType ?? '—'}
                  </span>
                </td>
                <td className="whitespace-nowrap">{formatCompetence(r.year, r.month)}</td>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(r.importedAt)}</td>
                <td>
                  <StatusBadge tone="green" dot>
                    Importado
                  </StatusBadge>
                </td>
                <td>
                  <div className="flex justify-end gap-1 whitespace-nowrap">
                    <button className="btn-outline btn-sm" onClick={() => onView(r)} aria-label={`Visualizar ${r.filename}`} title="Visualizar">
                      <Eye size={14} />
                    </button>
                    {action(r, 'xml', FileCode2, 'XML')}
                    {action(r, 'html', Globe, 'HTML')}
                    {action(r, 'pdf', FileText, 'PDF')}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onPageChange && total !== undefined && page && pageSize && <Pagination page={page} pageSize={pageSize} total={total} onChange={onPageChange} />}
    </div>
  );
}
