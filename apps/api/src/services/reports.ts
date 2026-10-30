import { describePeriod, formatCnpj, monthName, type ReportRequest, type ReportSummary } from '@gestao/shared';
import type { AppContext } from '../context';
import { Params, periodWhere, whereSql } from '../lib/filters';
import { enqueueJob } from './agent';
import { audit } from './audit';
import {
  COLORS,
  brandHeader,
  caption,
  createDoc,
  decoratePages,
  horizontalBarChart,
  loadLogo,
  monthlyColumnChart,
  sectionTitle,
  source,
  table,
  toBuffer,
} from './render/pdf';

export interface ReportData {
  summary: ReportSummary & { lastExecutionAt: string | null; generatedAt: string };
  companies: { name: string; cnpj: string; found: number; imported: number; duplicates: number; errors: number }[];
  monthly: number[];
  monthlyYearLabel: string;
  companyNames: string[];
}

const RF_COLS = { company: 'rf.company_id', year: 'rf.year', month: 'rf.month', date: 'rf.created_at' };

function periodLabel(f: ReportRequest): string {
  const parts: string[] = [describePeriod(f.year, f.month)];
  const fmt = (d: string) => d.split('-').reverse().join('/');
  if (f.dateFrom || f.dateTo) parts.push(`Execuções de ${f.dateFrom ? fmt(f.dateFrom) : 'início'} a ${f.dateTo ? fmt(f.dateTo) : 'hoje'}`);
  return parts.join(' · ');
}

export async function computeReportData(ctx: AppContext, f: ReportRequest): Promise<ReportData> {
  const p = new Params();
  const where = whereSql(periodWhere(f, p, RF_COLS));
  const companies = await ctx.db.query<{
    name: string;
    cnpj: string;
    found: number;
    imported: number;
    duplicates: number;
    errors: number;
  }>(
    `SELECT c.corporate_name AS name, c.cnpj,
            count(*)::int AS found,
            count(*) FILTER (WHERE rf.status = 'IMPORTED')::int AS imported,
            count(*) FILTER (WHERE rf.status = 'DUPLICATE')::int AS duplicates,
            count(*) FILTER (WHERE rf.status = 'ERROR')::int AS errors
       FROM import_run_files rf JOIN companies c ON c.id = rf.company_id
       ${where}
      GROUP BY c.id, c.corporate_name, c.cnpj
      ORDER BY c.corporate_name`,
    p.values,
  );

  // empresas analisadas: participaram de execuções no período, mesmo sem arquivos
  const pa = new Params();
  const analyzedWhere: string[] = [];
  if (f.companyIds.length) analyzedWhere.push(`irc.company_id = ANY(${pa.add(f.companyIds)}::int[])`);
  if (f.dateFrom) analyzedWhere.push(`r.created_at >= ${pa.add(f.dateFrom)}::date`);
  if (f.dateTo) analyzedWhere.push(`r.created_at < (${pa.add(f.dateTo)}::date + interval '1 day')`);
  if (f.year) analyzedWhere.push(`(r.year IS NULL OR r.year = ${pa.add(f.year)})`);
  if (f.month) analyzedWhere.push(`(r.month IS NULL OR r.month = ${pa.add(f.month)})`);
  const analyzed = await ctx.db.query<{ n: number; last: Date | null }>(
    `SELECT count(DISTINCT irc.company_id)::int AS n, max(r.finished_at) AS last
       FROM import_run_companies irc JOIN import_runs r ON r.id = irc.run_id
      ${whereSql(analyzedWhere)}`,
    pa.values,
  );

  const year = f.year ?? new Date().getFullYear();
  const pm = new Params();
  const monthlyRows = await ctx.db.query<{ month: number; n: number }>(
    `SELECT rf.month, count(*)::int AS n FROM import_run_files rf
      ${whereSql([...periodWhere({ ...f, year, month: undefined }, pm, RF_COLS), `rf.status = 'IMPORTED'`])}
      GROUP BY rf.month`,
    pm.values,
  );
  const monthly = Array.from({ length: 12 }, () => 0);
  for (const r of monthlyRows.rows) if (r.month >= 1 && r.month <= 12) monthly[r.month - 1] = r.n;

  let companyNames: string[] = [];
  if (f.companyIds.length) {
    const names = await ctx.db.query<{ corporate_name: string }>(
      'SELECT corporate_name FROM companies WHERE id = ANY($1::int[]) ORDER BY corporate_name',
      [f.companyIds],
    );
    companyNames = names.rows.map((n) => n.corporate_name);
  }

  const sum = (k: 'found' | 'imported' | 'duplicates' | 'errors') => companies.rows.reduce((a, r) => a + r[k], 0);
  return {
    summary: {
      companiesAnalyzed: Math.max(analyzed.rows[0]?.n ?? 0, companies.rows.length),
      filesFound: sum('found'),
      newFiles: sum('imported'),
      duplicates: sum('duplicates'),
      errors: sum('errors'),
      periodLabel: periodLabel(f),
      lastExecutionAt: analyzed.rows[0]?.last ? new Date(analyzed.rows[0].last).toISOString() : null,
      generatedAt: new Date().toISOString(),
    },
    companies: companies.rows,
    monthly,
    monthlyYearLabel: String(year),
    companyNames,
  };
}

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
const n = (v: number) => v.toLocaleString('pt-BR');

export async function renderReportPdf(ctx: AppContext, data: ReportData, requestedBy: string): Promise<Buffer> {
  const logo = loadLogo(ctx.config.logoPath);
  const doc = createDoc('Relatório de Processamento — REGISTROS XML-PDF');
  const generatedAt = new Date(data.summary.generatedAt);
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // ---- Capa ----
  doc.rect(0, 0, doc.page.width, 10).fill(COLORS.navy);
  doc.rect(0, 10, doc.page.width, 4).fill(COLORS.orange);
  let y = doc.page.margins.top;
  if (logo) {
    try {
      doc.image(logo, left + width / 2 - 80, y, { fit: [160, 70], align: 'center' });
    } catch {
      // ignora logo inválida
    }
    y += 90;
  }
  doc.font('Helvetica-Bold').fontSize(20).fillColor(COLORS.navy).text('GESTÃO CONTADORES', left, y, { width, align: 'center' });
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(14).fillColor(COLORS.text).text('Departamento Pessoal', { width, align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.orange).text('REGISTROS XML-PDF', { width, align: 'center' });

  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.navy).text('Relatório de Processamento', left, doc.page.height / 2 - 20, {
    width,
    align: 'center',
  });
  doc.moveDown(0.6);
  doc.font('Helvetica').fontSize(11.5).fillColor(COLORS.text).text(`Período selecionado: ${data.summary.periodLabel}`, { width, align: 'center' });
  if (data.companyNames.length) {
    doc.moveDown(0.3);
    const list = data.companyNames.length > 6 ? `${data.companyNames.length} empresas selecionadas` : data.companyNames.join(', ');
    doc.fontSize(10).fillColor(COLORS.muted).text(`Empresas: ${list}`, { width, align: 'center' });
  } else {
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor(COLORS.muted).text('Empresas: todas', { width, align: 'center' });
  }

  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text);
  const coverDate = generatedAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long', year: 'numeric' });
  doc.text(`Emitido por: ${requestedBy}`, left, doc.page.height - doc.page.margins.bottom - 50, { width, align: 'center' });
  doc.text(coverDate, { width, align: 'center' });

  // ---- Conteúdo ----
  doc.on('pageAdded', () => brandHeader(doc, logo, 'Departamento Pessoal · REGISTROS XML-PDF · Relatório de Processamento'));
  doc.addPage();

  sectionTitle(doc, '1 Resumo');
  table(
    doc,
    [
      { header: 'Indicador', width: 0.6 },
      { header: 'Valor', width: 0.4, align: 'right' },
    ],
    [
      ['Empresas analisadas', n(data.summary.companiesAnalyzed)],
      ['Arquivos encontrados', n(data.summary.filesFound)],
      ['Novos registros', n(data.summary.newFiles)],
      ['Registros já existentes', n(data.summary.duplicates)],
      ['Arquivos com erro', n(data.summary.errors)],
      ['Data da última execução no período', fmtDateTime(data.summary.lastExecutionAt)],
      ['Data de emissão do relatório', fmtDateTime(data.summary.generatedAt)],
    ],
  );
  source(doc, `Fonte: Sistema REGISTROS XML-PDF — Gestão Contadores (${generatedAt.getFullYear()}).`);

  sectionTitle(doc, '2 Arquivos importados por empresa');
  caption(doc, 'Gráfico 1 – Arquivos importados por empresa');
  horizontalBarChart(
    doc,
    [...data.companies].sort((a, b) => b.imported - a.imported).map((c) => ({ label: c.name, value: c.imported })),
  );
  source(doc, 'Fonte: Sistema REGISTROS XML-PDF — novos registros por empresa no período.');

  sectionTitle(doc, '3 Importações por mês');
  caption(doc, `Gráfico 2 – Importações por mês de competência (${data.monthlyYearLabel})`);
  monthlyColumnChart(doc, data.monthly);
  source(doc, 'Fonte: Sistema REGISTROS XML-PDF — novos registros por mês de competência.');

  sectionTitle(doc, '4 Detalhamento');
  caption(doc, 'Tabela 1 – Processamento por empresa');
  const rows = data.companies.map((c) => [
    `${c.name}\n${formatCnpj(c.cnpj)}`,
    n(c.found),
    n(c.imported),
    n(c.duplicates),
    n(c.errors),
  ]);
  rows.push([
    'Total',
    n(data.summary.filesFound),
    n(data.summary.newFiles),
    n(data.summary.duplicates),
    n(data.summary.errors),
  ]);
  table(
    doc,
    [
      { header: 'Empresa', width: 0.44 },
      { header: 'Encontrados', width: 0.14, align: 'right' },
      { header: 'Novos', width: 0.14, align: 'right' },
      { header: 'Existentes', width: 0.14, align: 'right' },
      { header: 'Erros', width: 0.14, align: 'right' },
    ],
    rows,
    { boldLast: true },
  );
  source(
    doc,
    'Fonte: Sistema REGISTROS XML-PDF. Nota: "Encontrados" soma os arquivos verificados nas execuções do período; ' +
      '"Existentes" são arquivos ignorados por já estarem registrados (controle por SHA-256).',
  );

  decoratePages(doc, { skipFirst: true, generatedAt });
  return toBuffer(doc);
}

/** Nome sugerido: Relatorio_XML_DP_2026-10_2026-10-30_114250.pdf */
export function reportFilename(f: ReportRequest, at: Date): string {
  const local = new Date(at.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const pad = (v: number) => String(v).padStart(2, '0');
  const ref = f.year ? (f.month ? `${f.year}-${pad(f.month)}` : `${f.year}`) : 'GERAL';
  const stamp = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}_${pad(local.getHours())}${pad(
    local.getMinutes(),
  )}${pad(local.getSeconds())}`;
  return `Relatorio_XML_DP_${ref}_${stamp}.pdf`;
}

export async function generateReport(ctx: AppContext, userId: number, userName: string, f: ReportRequest, req?: Parameters<typeof audit>[1]['req']) {
  const data = await computeReportData(ctx, f);
  const pdf = await renderReportPdf(ctx, data, userName);
  const now = new Date();
  const filename = reportFilename(f, now);
  const { rows } = await ctx.db.query<{ id: number }>(
    `INSERT INTO reports (requested_by, filters, summary, filename, pdf) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, JSON.stringify(f), JSON.stringify(data.summary), filename, pdf],
  );
  const reportId = rows[0]!.id;
  await queueReportSave(ctx, reportId, filename, userId, now);
  await audit(ctx.db, {
    userId,
    req,
    action: 'REPORT_GENERATED',
    entity: 'report',
    entityId: reportId,
    details: { filename, period: data.summary.periodLabel },
  });
  return { reportId, filename };
}

/** Pasta de destino: RELATORIOS ROBO\<ano>\<MM - MÊS> (mês/ano de emissão). */
export async function queueReportSave(ctx: AppContext, reportId: number, filename: string, userId: number | null, at = new Date()) {
  const local = new Date(at.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  await ctx.db.query(`UPDATE reports SET drive_status = 'PENDING', drive_error = NULL WHERE id = $1`, [reportId]);
  await enqueueJob(
    ctx.db,
    'SAVE_REPORT',
    { reportId, filename, year: local.getFullYear(), month: local.getMonth() + 1, monthName: monthName(local.getMonth() + 1) },
    userId,
  );
}
