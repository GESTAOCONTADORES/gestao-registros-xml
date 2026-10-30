import type { ReactNode } from 'react';

const TONES = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  orange: 'bg-orange-50 text-orange-600 ring-orange-100',
  navy: 'bg-navy-50 text-navy-800 ring-navy-100',
  gray: 'bg-slate-100 text-slate-600 ring-slate-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
};
export type Tone = keyof typeof TONES;

export function StatusBadge({ tone = 'gray', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${TONES[tone]}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const RUN_STATUS_TONE: Record<string, Tone> = {
  QUEUED: 'blue',
  RUNNING: 'orange',
  COMPLETED: 'green',
  COMPLETED_WITH_ERRORS: 'orange',
  CANCELLED: 'gray',
  FAILED: 'red',
};
export const FILE_STATUS_TONE: Record<string, Tone> = { IMPORTED: 'green', DUPLICATE: 'navy', ERROR: 'red' };
export const USER_STATUS_TONE: Record<string, Tone> = { PENDING: 'orange', ACTIVE: 'green', REJECTED: 'gray', BLOCKED: 'red' };
export const FOLDER_STATUS_TONE: Record<string, Tone> = { FOUND: 'green', NOT_FOUND: 'red', UNKNOWN: 'gray' };
