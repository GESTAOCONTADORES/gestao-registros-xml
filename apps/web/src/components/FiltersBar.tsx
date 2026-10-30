import { RotateCcw } from 'lucide-react';
import type { PeriodFilters } from '../api/hooks';
import { CompanySelector } from './CompanySelector';
import { MonthSelector } from './MonthSelector';
import { YearSelector } from './YearSelector';

/** Filtros de empresa, mês, ano e intervalo de datas (dashboard, registros, relatórios). */
export function FiltersBar({
  value,
  onChange,
  showDates = true,
  dateLabel = 'Data de importação',
  children,
}: {
  value: PeriodFilters;
  onChange: (f: PeriodFilters) => void;
  showDates?: boolean;
  dateLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card mb-5 p-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(240px,1fr)_minmax(140px,180px)_2fr]">
        <div>
          <span className="label">Empresa</span>
          <CompanySelector value={value.companyIds} onChange={(companyIds) => onChange({ ...value, companyIds })} />
        </div>
        <div>
          <label className="label" htmlFor="flt-year">
            Ano
          </label>
          <YearSelector id="flt-year" allowAll value={value.year} onChange={(year) => onChange({ ...value, year, month: year ? value.month : undefined })} />
        </div>
        <div>
          <span className="label">Mês {!value.year && <span className="normal-case">(selecione o ano)</span>}</span>
          <div className={value.year ? '' : 'pointer-events-none opacity-50'}>
            <MonthSelector value={value.month} onChange={(month) => onChange({ ...value, month })} />
          </div>
        </div>
      </div>
      {(showDates || children) && (
        <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-line pt-4">
          {showDates && (
            <>
              <div>
                <label className="label" htmlFor="flt-from">
                  {dateLabel} — de
                </label>
                <input id="flt-from" type="date" className="input" value={value.dateFrom ?? ''} onChange={(e) => onChange({ ...value, dateFrom: e.target.value || undefined })} />
              </div>
              <div>
                <label className="label" htmlFor="flt-to">
                  até
                </label>
                <input id="flt-to" type="date" className="input" value={value.dateTo ?? ''} onChange={(e) => onChange({ ...value, dateTo: e.target.value || undefined })} />
              </div>
            </>
          )}
          {children}
          <button className="btn-ghost ml-auto" onClick={() => onChange({ companyIds: [] })}>
            <RotateCcw size={15} /> Limpar filtros
          </button>
        </div>
      )}
    </div>
  );
}
