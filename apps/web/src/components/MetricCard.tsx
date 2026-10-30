import type { ReactNode } from 'react';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  hint?: ReactNode;
  accent?: 'navy' | 'orange' | 'red' | 'green';
}

const ACCENTS = {
  navy: 'bg-navy-50 text-navy-800',
  orange: 'bg-orange-50 text-orange-600',
  red: 'bg-red-50 text-red-600',
  green: 'bg-emerald-50 text-emerald-700',
};

export function MetricCard({ label, value, icon, hint, accent = 'navy' }: MetricCardProps) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className={`absolute inset-x-0 top-0 h-1 ${accent === 'orange' ? 'bg-orange-500' : accent === 'red' ? 'bg-red-500' : accent === 'green' ? 'bg-emerald-500' : 'bg-navy-800'}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
          <p className="mt-1 truncate text-2xl font-bold text-navy-900">{value}</p>
          {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
        </div>
        <div className={`rounded-lg p-2 ${ACCENTS[accent]}`}>{icon}</div>
      </div>
    </div>
  );
}
