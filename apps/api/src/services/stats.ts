import type { Db } from '@gestao/database';
import { availableYears, type DashboardDTO } from '@gestao/shared';
import { Params, periodWhere, whereSql, type PeriodFilterInput } from '../lib/filters';
import { RUN_COLUMNS, toRun } from '../lib/mappers';

const RF_COLS = { company: 'rf.company_id', year: 'rf.year', month: 'rf.month', date: 'rf.created_at' };
const F_COLS = { company: 'f.company_id', year: 'f.year', month: 'f.month', date: 'f.imported_at' };

export async function yearsWithData(db: Db): Promise<number[]> {
  const { rows } = await db.query<{ year: number }>(
    `SELECT DISTINCT year FROM imported_files WHERE year IS NOT NULL
     UNION SELECT DISTINCT year FROM import_run_files WHERE year IS NOT NULL`,
  );
  return availableYears(new Date(), rows.map((r) => r.year));
}

export async function dashboardStats(db: Db, f: PeriodFilterInput): Promise<DashboardDTO> {
  const monitored = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM companies WHERE deleted_at IS NULL AND status = 'ACTIVE'
       ${f.companyIds?.length ? 'AND id = ANY($1::int[])' : ''}`,
    f.companyIds?.length ? [f.companyIds] : [],
  );

  const p1 = new Params();
  const rfWhere = whereSql(periodWhere(f, p1, RF_COLS));
  const rf = await db.query<{ found: number; duplicates: number; errors: number }>(
    `SELECT count(DISTINCT COALESCE(rf.file_hash::text, rf.relative_path))::int AS found,
            count(*) FILTER (WHERE rf.status = 'DUPLICATE')::int AS duplicates,
            count(DISTINCT rf.company_id::text || ':' || rf.relative_path) FILTER (WHERE rf.status = 'ERROR')::int AS errors
       FROM import_run_files rf ${rfWhere}`,
    p1.values,
  );

  const p2 = new Params();
  const fWhere = whereSql(periodWhere(f, p2, F_COLS));
  const imported = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM imported_files f ${fWhere}`, p2.values);

  const p3 = new Params();
  const byCompany = await db.query<{ company_id: number; company_name: string; imported: number; duplicates: number; errors: number }>(
    `SELECT c.id AS company_id, c.corporate_name AS company_name,
            count(*) FILTER (WHERE rf.status = 'IMPORTED')::int AS imported,
            count(*) FILTER (WHERE rf.status = 'DUPLICATE')::int AS duplicates,
            count(*) FILTER (WHERE rf.status = 'ERROR')::int AS errors
       FROM import_run_files rf JOIN companies c ON c.id = rf.company_id
       ${whereSql(periodWhere(f, p3, RF_COLS))}
      GROUP BY c.id, c.corporate_name
      ORDER BY imported DESC, c.corporate_name`,
    p3.values,
  );

  // evolução mensal: o ano selecionado (ou o atual), sem filtrar o mês
  const year = f.year ?? new Date().getFullYear();
  const p4 = new Params();
  const monthly = await db.query<{ month: number; company_name: string; n: number }>(
    `SELECT f.month, c.corporate_name AS company_name, count(*)::int AS n
       FROM imported_files f JOIN companies c ON c.id = f.company_id
       ${whereSql(periodWhere({ ...f, year, month: undefined }, p4, F_COLS))}
      GROUP BY f.month, c.corporate_name`,
    p4.values,
  );
  const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, imported: 0, byCompany: {} as Record<string, number> }));
  for (const r of monthly.rows) {
    const m = byMonth[r.month - 1];
    if (!m) continue;
    m.imported += r.n;
    m.byCompany[r.company_name] = (m.byCompany[r.company_name] ?? 0) + r.n;
  }

  const last = await db.query(`SELECT ${RUN_COLUMNS} FROM import_runs r ORDER BY r.created_at DESC LIMIT 1`);

  return {
    monitoredCompanies: monitored.rows[0]!.n,
    filesFound: rf.rows[0]!.found,
    newFiles: imported.rows[0]!.n,
    duplicates: rf.rows[0]!.duplicates,
    errors: rf.rows[0]!.errors,
    lastRun: last.rows[0] ? toRun(last.rows[0]) : null,
    byCompany: byCompany.rows.map((r) => ({
      companyId: r.company_id,
      companyName: r.company_name,
      imported: r.imported,
      duplicates: r.duplicates,
      errors: r.errors,
    })),
    byMonth,
    years: await yearsWithData(db),
  };
}
