import { MONTHS_SHORT, MONTHS } from '@gestao/shared';

/** Botões de Janeiro a Dezembro + "Todos os meses". */
export function MonthSelector({ value, onChange, allowAll = true }: { value?: number; onChange: (m?: number) => void; allowAll?: boolean }) {
  const btn = (active: boolean) =>
    `rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors ${
      active ? 'border-orange-500 bg-orange-500 text-white shadow-sm' : 'border-line bg-white text-navy-900 hover:border-navy-800'
    }`;
  return (
    <div role="group" aria-label="Mês" className="@container">
      <div className="grid grid-cols-4 gap-1.5 @xs:grid-cols-6 @xl:grid-cols-12">
        {MONTHS.map((m, i) => (
          <button key={m} type="button" title={m} className={btn(value === i + 1)} onClick={() => onChange(i + 1)} aria-pressed={value === i + 1}>
            <span className="hidden @6xl:inline">{m}</span>
            <span className="@6xl:hidden">{MONTHS_SHORT[i]}</span>
          </button>
        ))}
      </div>
      {allowAll && (
        <button type="button" className={`${btn(!value)} mt-1.5 w-full`} onClick={() => onChange(undefined)} aria-pressed={!value}>
          Todos os meses
        </button>
      )}
    </div>
  );
}
