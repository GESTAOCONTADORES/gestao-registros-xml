import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MONTHS, MONTHS_SHORT, type DashboardDTO } from '@gestao/shared';
import { EmptyState } from './States';

const ORANGE = '#f07d1a';
const NAVY = '#0f2a4a';
// paleta para detalhamento por empresa: navy/laranja e tons intermediários
const SERIES = ['#f07d1a', '#0f2a4a', '#2a5288', '#f59a4a', '#5b7fa8', '#b35a0c', '#8aa3c2', '#d98c4f', '#1d3f6b', '#c4682a'];

const tooltipStyle = { borderRadius: 8, border: '1px solid #e3e8ef', fontSize: 12 };

/** "Arquivos importados por empresa" — colunas laranja. */
export function CompanyBarChart({ data }: { data: DashboardDTO['byCompany'] }) {
  const rows = useMemo(() => data.filter((d) => d.imported > 0 || d.duplicates > 0 || d.errors > 0).slice(0, 25), [data]);
  return (
    <div className="card p-4">
      <h3 className="card-title">Arquivos importados por empresa</h3>
      {rows.length === 0 ? (
        <EmptyState title="Sem importações no período" message="Ajuste os filtros ou inicie uma pesquisa." />
      ) : (
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#eef1f5" />
              <XAxis dataKey="companyName" tick={{ fontSize: 11, fill: '#5b6b80' }} interval={0} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} height={40} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#5b6b80' }} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f3f6fa' }} formatter={(v: number) => v.toLocaleString('pt-BR')} />
              <Bar dataKey="imported" name="Importados" fill={ORANGE} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {data.length > 25 && <p className="mt-2 text-xs text-muted">Exibindo as 25 empresas com mais importações.</p>}
    </div>
  );
}

/** "Evolução mensal das importações" — janeiro a dezembro, consolidado ou detalhado por empresa. */
export function MonthlyChart({ data, year, multiCompany }: { data: DashboardDTO['byMonth']; year: number; multiCompany: boolean }) {
  const [detail, setDetail] = useState(false);
  const companies = useMemo(() => {
    const totals = new Map<string, number>();
    for (const m of data) for (const [name, n] of Object.entries(m.byCompany)) totals.set(name, (totals.get(name) ?? 0) + n);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }, [data]);
  const top = companies.slice(0, 9);
  const rows = data.map((m) => {
    const row: Record<string, number | string> = { month: MONTHS_SHORT[m.month - 1]!, fullMonth: MONTHS[m.month - 1]!, imported: m.imported };
    if (detail) {
      let other = 0;
      for (const [name, n] of Object.entries(m.byCompany)) {
        if (top.includes(name)) row[name] = n;
        else other += n;
      }
      if (other) row['Outras empresas'] = other;
    }
    return row;
  });
  const series = detail ? [...top, ...(companies.length > top.length ? ['Outras empresas'] : [])] : [];
  const empty = data.every((m) => m.imported === 0);
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="card-title">Evolução mensal das importações · {year}</h3>
        {multiCompany && companies.length > 1 && (
          <div className="flex rounded-lg border border-line p-0.5 text-xs font-semibold">
            <button className={`rounded-md px-2.5 py-1 ${!detail ? 'bg-navy-900 text-white' : 'text-navy-800'}`} onClick={() => setDetail(false)}>
              Consolidado
            </button>
            <button className={`rounded-md px-2.5 py-1 ${detail ? 'bg-navy-900 text-white' : 'text-navy-800'}`} onClick={() => setDetail(true)}>
              Por empresa
            </button>
          </div>
        )}
      </div>
      {empty ? (
        <EmptyState title="Sem importações neste ano" />
      ) : (
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#eef1f5" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#5b6b80' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#5b6b80' }} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: '#f3f6fa' }}
                labelFormatter={(_l, p) => (p?.[0]?.payload as { fullMonth?: string })?.fullMonth ?? ''}
                formatter={(v: number) => v.toLocaleString('pt-BR')}
              />
              {detail ? (
                <>
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {series.map((s, i) => (
                    <Bar key={s} dataKey={s} stackId="a" fill={SERIES[i % SERIES.length]} maxBarSize={44} />
                  ))}
                </>
              ) : (
                <Bar dataKey="imported" name="Importados" fill={NAVY} radius={[4, 4, 0, 0]} maxBarSize={44} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
