import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fmtNumber } from '../lib/format';

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm text-muted">
      <span>
        {fmtNumber(from)}–{fmtNumber(to)} de {fmtNumber(total)}
      </span>
      <div className="flex items-center gap-1">
        <button className="btn-outline btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Página anterior">
          <ChevronLeft size={16} />
        </button>
        <span className="px-2 font-medium text-navy-900">
          {page} / {pages}
        </span>
        <button className="btn-outline btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Próxima página">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
