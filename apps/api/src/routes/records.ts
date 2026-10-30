import type { FastifyInstance, FastifyRequest } from 'fastify';
import archiver from 'archiver';
import { parseXmlTree } from '@gestao/xml-parser';
import {
  bulkDownloadSchema,
  onlyDigits,
  recordsQuerySchema,
  safeFileName,
  stripAccents,
  type RecordDetailDTO,
  type RecordDTO,
} from '@gestao/shared';
import type { AppContext } from '../context';
import { Params, periodWhere, whereSql } from '../lib/filters';
import { HttpError, attachment, idParam, notFound, parse } from '../lib/http';
import { RECORD_COLUMNS, toRecord } from '../lib/mappers';
import { authenticate } from '../plugins/auth';
import { audit } from '../services/audit';
import { renderRecordHtml } from '../services/render/html';
import { loadLogo, renderRecordPdf } from '../services/render/pdf';

const F_COLS = { company: 'f.company_id', year: 'f.year', month: 'f.month', date: 'f.imported_at' };
const MAX_BULK = 5000;

let logoCache: { path: string; buf: Buffer | null } | null = null;
function logo(ctx: AppContext): Buffer | null {
  if (!logoCache || logoCache.path !== ctx.config.logoPath) {
    logoCache = { path: ctx.config.logoPath, buf: loadLogo(ctx.config.logoPath) };
  }
  return logoCache.buf;
}
const logoDataUri = (ctx: AppContext) => {
  const b = logo(ctx);
  return b ? `data:image/png;base64,${b.toString('base64')}` : null;
};

async function loadRecord(ctx: AppContext, id: number): Promise<RecordDetailDTO> {
  const { rows } = await ctx.db.query(
    `SELECT ${RECORD_COLUMNS}, f.xml_metadata FROM imported_files f JOIN companies c ON c.id = f.company_id WHERE f.id = $1`,
    [id],
  );
  if (!rows[0]) throw notFound('Registro não encontrado.');
  return { ...toRecord(rows[0]), metadata: (rows[0] as { xml_metadata: Record<string, unknown> }).xml_metadata ?? {} };
}

async function loadContent(ctx: AppContext, id: number): Promise<Buffer> {
  const { rows } = await ctx.db.query<{ content: Uint8Array }>(
    'SELECT content FROM imported_file_contents WHERE imported_file_id = $1',
    [id],
  );
  if (!rows[0]) throw notFound('Conteúdo do XML não encontrado.');
  return Buffer.from(rows[0].content);
}

const baseName = (filename: string) => filename.replace(/\.xml$/i, '');

async function renderAs(ctx: AppContext, record: RecordDTO, content: Buffer, format: 'xml' | 'html' | 'pdf') {
  if (format === 'xml') return { body: content, type: 'application/xml', name: record.filename };
  const root = parseXmlTree(content);
  if (format === 'html') {
    return {
      body: Buffer.from(renderRecordHtml(record, root, logoDataUri(ctx)), 'utf8'),
      type: 'text/html; charset=utf-8',
      name: `${baseName(record.filename)}.html`,
    };
  }
  return { body: await renderRecordPdf(record, root, logo(ctx)), type: 'application/pdf', name: `${baseName(record.filename)}.pdf` };
}

function buildRecordsWhere(q: ReturnType<typeof recordsQuerySchema.parse>) {
  const p = new Params();
  const where = periodWhere(q, p, F_COLS);
  if (q.documentType) where.push(`f.document_type = ${p.add(q.documentType)}`);
  if (q.search) {
    const term = stripAccents(q.search).toLowerCase().trim();
    const digits = onlyDigits(q.search);
    const ors = [`f.search_text LIKE ${p.add(`%${term}%`)}`, `c.corporate_name ILIKE ${p.add(`%${q.search}%`)}`, `c.trade_name ILIKE ${p.add(`%${q.search}%`)}`];
    if (digits.length >= 3 && digits !== term) ors.push(`f.search_text LIKE ${p.add(`%${digits}%`)}`);
    where.push(`(${ors.join(' OR ')})`);
  }
  return { p, where: whereSql(where) };
}

export async function recordRoutes(app: FastifyInstance) {
  const ctx = app.ctx;
  const auth = authenticate(ctx);

  app.get('/records', { preHandler: auth }, async (req) => {
    const q = parse(recordsQuerySchema, req.query);
    const { p, where } = buildRecordsWhere(q);
    const total = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM imported_files f JOIN companies c ON c.id = f.company_id ${where}`,
      p.values,
    );
    const { rows } = await ctx.db.query(
      `SELECT ${RECORD_COLUMNS} FROM imported_files f JOIN companies c ON c.id = f.company_id ${where}
        ORDER BY f.imported_at DESC, f.id DESC
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
      p.values,
    );
    return { items: rows.map(toRecord), total: total.rows[0]!.n, page: q.page, pageSize: q.pageSize };
  });

  app.get('/records/document-types', { preHandler: auth }, async () => {
    const { rows } = await ctx.db.query<{ document_type: string; label: string; n: number }>(
      `SELECT document_type, max(document_type_label) AS label, count(*)::int AS n
         FROM imported_files WHERE document_type IS NOT NULL GROUP BY document_type ORDER BY label`,
    );
    return rows.map((r) => ({ value: r.document_type, label: r.label ?? r.document_type, count: r.n }));
  });

  app.get('/records/:id', { preHandler: auth }, async (req) => {
    const record = await loadRecord(ctx, idParam(req));
    const history = await ctx.db.query(
      `SELECT rf.run_id, rf.status, rf.relative_path, rf.created_at FROM import_run_files rf
        WHERE rf.file_hash = $1 ORDER BY rf.created_at DESC LIMIT 50`,
      [record.fileHash],
    );
    return { ...record, occurrences: history.rows };
  });

  const download = (format: 'xml' | 'html' | 'pdf') => async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const id = idParam(req);
    const record = await loadRecord(ctx, id);
    const content = await loadContent(ctx, id);
    const out = await renderAs(ctx, record, content, format);
    await audit(ctx.db, { req, action: 'DOWNLOAD', entity: 'imported_file', entityId: id, details: { format, filename: record.filename } });
    reply
      .header('Content-Type', out.type)
      .header('Content-Disposition', attachment(out.name))
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff');
    return out.body;
  };
  app.get('/records/:id/xml', { preHandler: auth }, download('xml'));
  app.get('/records/:id/html', { preHandler: auth }, download('html'));
  app.get('/records/:id/pdf', { preHandler: auth }, download('pdf'));

  /** Download em lote: um arquivo direto, ou ZIP quando houver vários. */
  app.post('/records/bulk-download', { preHandler: auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(bulkDownloadSchema, req.body);
    const p = new Params();
    const where = whereSql(periodWhere(body, p, F_COLS));
    const { rows } = await ctx.db.query(
      `SELECT ${RECORD_COLUMNS} FROM imported_files f JOIN companies c ON c.id = f.company_id ${where}
        ORDER BY c.corporate_name, f.year, f.month, f.filename LIMIT ${MAX_BULK + 1}`,
      p.values,
    );
    if (!rows.length) throw notFound('Nenhum arquivo encontrado para os filtros selecionados.');
    if (rows.length > MAX_BULK) throw new HttpError(400, `Seleção muito grande (mais de ${MAX_BULK} arquivos). Refine os filtros.`);
    const records = rows.map(toRecord);
    await audit(ctx.db, {
      req,
      action: 'DOWNLOAD',
      entity: 'imported_file',
      details: { format: body.format, bulk: true, count: records.length, filters: body },
    });

    if (records.length === 1) {
      const r = records[0]!;
      const out = await renderAs(ctx, r, await loadContent(ctx, r.id), body.format);
      reply.header('Content-Type', out.type).header('Content-Disposition', attachment(out.name)).header('Cache-Control', 'no-store');
      return out.body;
    }

    const companies = [...new Set(records.map((r) => r.companyName))];
    const who = companies.length === 1 ? safeFileName(companies[0]!).toUpperCase() : 'VARIAS_EMPRESAS';
    const period = body.year ? (body.month ? `${body.year}-${String(body.month).padStart(2, '0')}` : `${body.year}`) : 'TODOS';
    // ex.: GESTAO_XML_ABC_LTDA_2026-10.zip (HTML/PDF recebem o sufixo do formato)
    const zipName = `GESTAO_XML_${who}_${period}${body.format === 'xml' ? '' : `_${body.format.toUpperCase()}`}.zip`;

    const archive = archiver('zip', { zlib: { level: 6 } });
    reply.header('Content-Type', 'application/zip').header('Content-Disposition', attachment(zipName)).header('Cache-Control', 'no-store');
    const used = new Set<string>();
    void (async () => {
      try {
        for (const r of records) {
          const out = await renderAs(ctx, r, await loadContent(ctx, r.id), body.format).catch((e: Error) => ({
            body: Buffer.from(`Não foi possível gerar ${body.format.toUpperCase()} para ${r.filename}: ${e.message}\n`),
            type: 'text/plain',
            name: `${baseName(r.filename)}.ERRO.txt`,
          }));
          const folder = companies.length > 1 ? `${safeFileName(r.companyName)}/` : '';
          let name = `${folder}${out.name}`;
          for (let i = 2; used.has(name.toLowerCase()); i++) name = `${folder}${baseName(out.name)}_${i}${out.name.slice(out.name.lastIndexOf('.'))}`;
          used.add(name.toLowerCase());
          archive.append(out.body, { name, date: r.fileModifiedAt ? new Date(r.fileModifiedAt) : new Date() });
        }
        await archive.finalize();
      } catch (err) {
        ctx.log.error({ err }, 'Falha ao gerar ZIP');
        archive.abort();
      }
    })();
    return reply.send(archive);
  });
}
