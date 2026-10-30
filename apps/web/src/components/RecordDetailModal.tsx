import { useQuery } from '@tanstack/react-query';
import { FileCode2, FileText, Globe } from 'lucide-react';
import {
  COMPETENCE_SOURCE_LABELS,
  RUN_FILE_STATUS_LABELS,
  formatBytes,
  formatCnpj,
  formatCompetence,
  formatCpf,
  type RecordDetailDTO,
} from '@gestao/shared';
import { get } from '../api/client';
import { fmtDate, fmtDateTime } from '../lib/format';
import { Modal } from './Modal';
import { useRecordDownload } from './RecordsTable';
import { ErrorState, LoadingState } from './States';
import { FILE_STATUS_TONE, StatusBadge } from './StatusBadge';

type Detail = RecordDetailDTO & { occurrences: { run_id: number; status: string; relative_path: string; created_at: string }[] };

export function RecordDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['record', recordId], queryFn: () => get<Detail>(`/records/${recordId}`), enabled: !!recordId });
  const { download, busy } = useRecordDownload();
  const r = q.data;
  const rows: [string, string][] = r
    ? [
        ['Empresa', r.companyName],
        ['CNPJ', formatCnpj(r.companyCnpj)],
        ['Tipo do documento', r.documentTypeLabel ?? r.documentType ?? '—'],
        ['Código do evento', r.eventCode ?? '—'],
        ['Competência', formatCompetence(r.year, r.month)],
        ['Origem da competência', r.competenceSource ? COMPETENCE_SOURCE_LABELS[r.competenceSource] : '—'],
        ['Trabalhador', r.workerName ?? '—'],
        ['CPF', r.workerCpf ? formatCpf(r.workerCpf) : '—'],
        ['Inscrição do empregador (XML)', r.employerCnpj ? formatCnpj(r.employerCnpj) : '—'],
        ['Protocolo', r.protocol ?? '—'],
        ['Recibo', r.receipt ?? '—'],
        ['Identificador', r.documentId ?? '—'],
        ['Data do documento', fmtDate(r.documentDate)],
        ['Arquivo', r.filename],
        ['Caminho', `${r.folderName}\\${r.relativePath}`],
        ['Tamanho', formatBytes(r.fileSize)],
        ['Data do arquivo', fmtDateTime(r.fileModifiedAt)],
        ['Importado em', fmtDateTime(r.importedAt)],
        ['Importado por', r.importedByName ?? '—'],
        ['Pesquisa (lote)', r.importRunId ? `#${r.importRunId}` : '—'],
        ['Hash SHA-256', r.fileHash],
      ]
    : [];
  const extra = r?.metadata && typeof r.metadata.extra === 'object' && r.metadata.extra ? Object.entries(r.metadata.extra as Record<string, unknown>) : [];

  return (
    <Modal
      open={!!recordId}
      onClose={onClose}
      size="xl"
      title={r ? r.documentTypeLabel ?? r.filename : 'Registro'}
      footer={
        r && (
          <>
            {(['xml', 'html', 'pdf'] as const).map((f) => {
              const Icon = f === 'xml' ? FileCode2 : f === 'html' ? Globe : FileText;
              return (
                <button key={f} className={f === 'pdf' ? 'btn-primary' : 'btn-outline'} disabled={busy === `${r.id}:${f}`} onClick={() => download(r, f)}>
                  <Icon size={16} /> Baixar {f.toUpperCase()}
                </button>
              );
            })}
          </>
        )
      }
    >
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {r && (
        <div className="space-y-5">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k} className="border-b border-line pb-1.5">
                <dt className="text-xs font-semibold text-muted uppercase">{k}</dt>
                <dd className={`break-words text-ink ${k === 'Hash SHA-256' ? 'font-mono text-xs' : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
          {extra.length > 0 && (
            <div>
              <h4 className="card-title mb-2">Outras informações do XML</h4>
              <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                {extra.map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-navy-50 px-3 py-2">
                    <dt className="font-mono text-xs text-muted">{k}</dt>
                    <dd className="break-words">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {r.occurrences?.length > 0 && (
            <div>
              <h4 className="card-title mb-2">Ocorrências nas pesquisas</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Pesquisa</th>
                    <th>Caminho</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {r.occurrences.map((o, i) => (
                    <tr key={i}>
                      <td className="text-xs">{fmtDateTime(o.created_at)}</td>
                      <td>#{o.run_id}</td>
                      <td className="max-w-xs truncate text-xs">{o.relative_path}</td>
                      <td>
                        <StatusBadge tone={FILE_STATUS_TONE[o.status]}>{RUN_FILE_STATUS_LABELS[o.status as 'IMPORTED'] ?? o.status}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted">O XML original é mantido exatamente como foi encontrado; HTML e PDF são gerados a partir dele.</p>
        </div>
      )}
    </Modal>
  );
}
