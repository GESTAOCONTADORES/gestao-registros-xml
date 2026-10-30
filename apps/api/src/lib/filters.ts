/** Montador simples de cláusulas WHERE parametrizadas. */
export class Params {
  values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export interface PeriodFilterInput {
  companyIds?: number[];
  year?: number | null;
  month?: number | null;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Filtros de empresa, competência (ano/mês) e intervalo de datas.
 * `dateColumn` é a coluna usada para o intervalo (ex.: data de importação).
 */
export function periodWhere(
  f: PeriodFilterInput,
  p: Params,
  cols: { company: string; year: string; month: string; date: string },
): string[] {
  const where: string[] = [];
  if (f.companyIds?.length) where.push(`${cols.company} = ANY(${p.add(f.companyIds)}::int[])`);
  if (f.year) where.push(`${cols.year} = ${p.add(f.year)}`);
  if (f.month) where.push(`${cols.month} = ${p.add(f.month)}`);
  if (f.dateFrom) where.push(`${cols.date} >= ${p.add(f.dateFrom)}::date`);
  if (f.dateTo) where.push(`${cols.date} < (${p.add(f.dateTo)}::date + interval '1 day')`);
  return where;
}

export const whereSql = (parts: string[]) => (parts.length ? `WHERE ${parts.join(' AND ')}` : '');
