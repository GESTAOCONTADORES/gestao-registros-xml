import { z } from 'zod';
import { parseXmlFile, XmlParseError } from '@gestao/xml-parser';
import { stripAccents, type AgentFilesBatchResult } from '@gestao/shared';
import type { AppContext } from '../context';
import { HttpError, notFound, parse } from '../lib/http';
import { sha256 } from '../plugins/auth';
import { recomputeProgress } from './runs';

const hash = z.string().regex(/^[a-f0-9]{64}$/i).transform((v) => v.toLowerCase());
const relPath = z
  .string()
  .min(1)
  .max(1000)
  .refine((p) => !p.split(/[\\/]/).includes('..') && !/^[a-zA-Z]:/.test(p) && !p.startsWith('\\\\'), 'Caminho inválido');
const fileBase = {
  companyId: z.number().int().positive(),
  filename: z.string().min(1).max(300),
  relativePath: relPath,
};

export const agentBatchSchema = z.object({
  imported: z
    .array(
      z.object({
        ...fileBase,
        fileHash: hash,
        fileSize: z.number().int().nonnegative(),
        fileModifiedAt: z.string().datetime(),
        contentBase64: z.string().min(1),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .max(200)
    .default([]),
  duplicates: z
    .array(
      z.object({
        ...fileBase,
        fileHash: hash,
        fileSize: z.number().int().nonnegative(),
        fileModifiedAt: z.string().datetime(),
        year: z.number().int().nullable().optional(),
        month: z.number().int().min(1).max(12).nullable().optional(),
      }),
    )
    .max(2000)
    .default([]),
  errors: z
    .array(
      z.object({
        ...fileBase,
        fileHash: hash.nullable().optional(),
        fileSize: z.number().int().nonnegative().nullable().optional(),
        fileModifiedAt: z.string().datetime().nullable().optional(),
        errorMessage: z.string().max(2000),
        year: z.number().int().nullable().optional(),
        month: z.number().int().min(1).max(12).nullable().optional(),
        contentBase64: z.string().nullable().optional(),
      }),
    )
    .max(2000)
    .default([]),
});

const MAX_ERROR_CONTENT = 5 * 1024 * 1024;

function normalizeSearch(parts: (string | null | undefined)[]): string {
  return stripAccents(parts.filter(Boolean).join(' | ')).toLowerCase();
}

export async function ingestBatch(ctx: AppContext, runId: number, body: unknown): Promise<AgentFilesBatchResult> {
  const input = parse(agentBatchSchema, body);
  const runRes = await ctx.db.query<{ status: string; requested_by: number | null; cancel_requested: boolean }>(
    'SELECT status, requested_by, cancel_requested FROM import_runs WHERE id = $1',
    [runId],
  );
  const run = runRes.rows[0];
  if (!run) throw notFound('Execução não encontrada.');
  if (run.status !== 'RUNNING') throw new HttpError(409, 'A execução não está em andamento.', 'RUN_NOT_RUNNING');

  const companiesRes = await ctx.db.query<{ company_id: number; corporate_name: string; cnpj: string }>(
    `SELECT irc.company_id, c.corporate_name, c.cnpj
       FROM import_run_companies irc JOIN companies c ON c.id = irc.company_id WHERE irc.run_id = $1`,
    [runId],
  );
  const companies = new Map(companiesRes.rows.map((c) => [c.company_id, c]));

  type Outcome = { companyId: number; status: 'IMPORTED' | 'DUPLICATE' | 'ERROR' };
  const outcomes: Outcome[] = [];

  await ctx.db.transaction(async (tx) => {
    const insertRunFile = async (f: {
      companyId: number;
      filename: string;
      relativePath: string;
      fileHash: string | null;
      fileSize: number | null;
      fileModifiedAt: string | null;
      status: Outcome['status'];
      errorMessage?: string | null;
      importedFileId?: number | null;
      year?: number | null;
      month?: number | null;
      content?: Buffer | null;
    }) => {
      await tx.query(
        `INSERT INTO import_run_files (run_id, company_id, filename, relative_path, file_hash, file_size, file_modified_at,
                                       status, error_message, imported_file_id, year, month, content)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          runId,
          companies.has(f.companyId) ? f.companyId : null,
          f.filename,
          f.relativePath,
          f.fileHash,
          f.fileSize,
          f.fileModifiedAt,
          f.status,
          f.errorMessage ?? null,
          f.importedFileId ?? null,
          f.year ?? null,
          f.month ?? null,
          f.content ?? null,
        ],
      );
      outcomes.push({ companyId: f.companyId, status: f.status });
    };

    // ---- arquivos novos ----
    for (const f of input.imported) {
      const base = {
        companyId: f.companyId,
        filename: f.filename,
        relativePath: f.relativePath,
        fileSize: f.fileSize,
        fileModifiedAt: f.fileModifiedAt,
      };
      const company = companies.get(f.companyId);
      if (!company) {
        await insertRunFile({ ...base, fileHash: f.fileHash, status: 'ERROR', errorMessage: 'Empresa não pertence a esta pesquisa' });
        continue;
      }
      const content = Buffer.from(f.contentBase64, 'base64');
      if (content.length > ctx.config.maxXmlFileBytes) {
        await insertRunFile({ ...base, fileHash: f.fileHash, status: 'ERROR', errorMessage: 'Arquivo acima do tamanho máximo permitido' });
        continue;
      }
      // o hash é recalculado no servidor: nunca confiar só no que foi informado
      const realHash = sha256(content);
      if (realHash !== f.fileHash || content.length !== f.fileSize) {
        await insertRunFile({
          ...base,
          fileHash: realHash,
          status: 'ERROR',
          errorMessage: 'Conteúdo divergente do hash informado (arquivo alterado durante a leitura?)',
        });
        continue;
      }

      let metadata;
      try {
        metadata = parseXmlFile(content, new Date(f.fileModifiedAt)).metadata;
      } catch (e) {
        const msg = e instanceof XmlParseError ? e.message : `Falha ao ler o XML: ${(e as Error).message}`;
        await insertRunFile({
          ...base,
          fileHash: realHash,
          status: 'ERROR',
          errorMessage: msg,
          content: content.length <= MAX_ERROR_CONTENT ? content : null,
        });
        continue;
      }

      const [yy, mm] = [metadata.year, metadata.month];
      const searchText = normalizeSearch([
        company.corporate_name,
        company.cnpj,
        f.filename,
        metadata.workerName,
        metadata.workerCpf,
        metadata.employerCnpj,
        metadata.competence,
        `${String(mm).padStart(2, '0')}/${yy}`,
        metadata.protocol,
        metadata.receipt,
        metadata.documentTypeLabel,
        metadata.eventCode,
        metadata.documentId,
      ]);
      const ins = await tx.query<{ id: number }>(
        `INSERT INTO imported_files (company_id, filename, relative_path, file_hash, file_size, file_modified_at,
            competence, competence_source, month, year, document_type, document_type_label, event_code, document_id,
            document_date, employer_cnpj, worker_cpf, worker_name, protocol, receipt, xml_metadata, search_text,
            import_run_id, imported_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         ON CONFLICT (file_hash) DO NOTHING
         RETURNING id`,
        [
          f.companyId,
          f.filename,
          f.relativePath,
          realHash,
          content.length,
          f.fileModifiedAt,
          metadata.competence,
          metadata.competenceSource,
          mm,
          yy,
          metadata.documentType,
          metadata.documentTypeLabel,
          metadata.eventCode,
          metadata.documentId,
          metadata.documentDate,
          metadata.employerCnpj,
          metadata.workerCpf,
          metadata.workerName,
          metadata.protocol,
          metadata.receipt,
          JSON.stringify(metadata),
          searchText,
          runId,
          run.requested_by,
        ],
      );
      const newId = ins.rows[0]?.id;
      if (newId) {
        await tx.query('INSERT INTO imported_file_contents (imported_file_id, content) VALUES ($1, $2)', [newId, content]);
        await insertRunFile({ ...base, fileHash: realHash, status: 'IMPORTED', importedFileId: newId, year: yy, month: mm });
      } else {
        // já existia (outro caminho, outra execução ou repetido neste lote): nunca substituir
        const existing = await tx.query<{ id: number }>('SELECT id FROM imported_files WHERE file_hash = $1', [realHash]);
        await insertRunFile({
          ...base,
          fileHash: realHash,
          status: 'DUPLICATE',
          importedFileId: existing.rows[0]?.id ?? null,
          year: yy,
          month: mm,
        });
      }
    }

    // ---- arquivos que o agente identificou como já importados ----
    if (input.duplicates.length) {
      const known = await tx.query<{ id: number; file_hash: string }>(
        'SELECT id, file_hash FROM imported_files WHERE file_hash = ANY($1::char(64)[])',
        [input.duplicates.map((d) => d.fileHash)],
      );
      const byHash = new Map(known.rows.map((k) => [k.file_hash.trim(), k.id]));
      for (const d of input.duplicates) {
        const id = byHash.get(d.fileHash);
        await insertRunFile({
          companyId: d.companyId,
          filename: d.filename,
          relativePath: d.relativePath,
          fileHash: d.fileHash,
          fileSize: d.fileSize,
          fileModifiedAt: d.fileModifiedAt,
          status: id ? 'DUPLICATE' : 'ERROR',
          errorMessage: id ? null : 'Arquivo não localizado na base; será reprocessado na próxima pesquisa',
          importedFileId: id ?? null,
          year: d.year ?? null,
          month: d.month ?? null,
        });
      }
    }

    // ---- erros de leitura no agente ----
    for (const e of input.errors) {
      let content: Buffer | null = null;
      if (e.contentBase64) {
        const buf = Buffer.from(e.contentBase64, 'base64');
        if (buf.length <= MAX_ERROR_CONTENT) content = buf;
      }
      await insertRunFile({
        companyId: e.companyId,
        filename: e.filename,
        relativePath: e.relativePath,
        fileHash: e.fileHash ?? null,
        fileSize: e.fileSize ?? null,
        fileModifiedAt: e.fileModifiedAt ?? null,
        status: 'ERROR',
        errorMessage: e.errorMessage,
        year: e.year ?? null,
        month: e.month ?? null,
        content,
      });
    }

    // ---- contadores ----
    const totals = { IMPORTED: 0, DUPLICATE: 0, ERROR: 0 };
    const perCompany = new Map<number, typeof totals>();
    for (const o of outcomes) {
      totals[o.status]++;
      if (!companies.has(o.companyId)) continue;
      const c = perCompany.get(o.companyId) ?? { IMPORTED: 0, DUPLICATE: 0, ERROR: 0 };
      c[o.status]++;
      perCompany.set(o.companyId, c);
    }
    await tx.query(
      `UPDATE import_runs SET new_files = new_files + $2, duplicates = duplicates + $3, errors = errors + $4,
              last_agent_update_at = now(), updated_at = now()
        WHERE id = $1`,
      [runId, totals.IMPORTED, totals.DUPLICATE, totals.ERROR],
    );
    for (const [companyId, c] of perCompany) {
      await tx.query(
        `UPDATE import_run_companies SET new_files = new_files + $3, duplicates = duplicates + $4, errors = errors + $5
          WHERE run_id = $1 AND company_id = $2`,
        [runId, companyId, c.IMPORTED, c.DUPLICATE, c.ERROR],
      );
    }
  });

  await recomputeProgress(ctx.db, runId);
  const after = await ctx.db.query<{ cancel_requested: boolean }>('SELECT cancel_requested FROM import_runs WHERE id = $1', [runId]);
  return {
    imported: outcomes.filter((o) => o.status === 'IMPORTED').length,
    duplicates: outcomes.filter((o) => o.status === 'DUPLICATE').length,
    errors: outcomes.filter((o) => o.status === 'ERROR').length,
    cancelRequested: !!after.rows[0]?.cancel_requested,
  };
}
