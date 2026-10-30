import { promises as fsp } from 'node:fs';
import { parseXmlFile } from '@gestao/xml-parser';
import type {
  AgentDuplicateFile,
  AgentErrorFile,
  AgentFileMetadata,
  AgentUploadFile,
  RunCompanyDTO,
  ScanJobPayload,
} from '@gestao/shared';
import type { AgentApi } from './api-client';
import { FileCache } from './cache';
import type { AgentConfig } from './config';
import { isDirectory, listXmlFiles, safeJoin, sha256, type FoundFile } from './fs-utils';
import type { Logger } from './logger';

export interface ScanContext {
  api: AgentApi;
  config: AgentConfig;
  log: Logger;
  cache: FileCache;
  /** Pedido de parada do serviço (Windows encerrando). */
  shuttingDown: () => boolean;
}

export interface ScanResult {
  /** INTERRUPTED = o serviço do Windows foi encerrado no meio da pesquisa. */
  status: 'DONE' | 'CANCELLED' | 'INTERRUPTED';
  companiesProcessed: number;
  filesChecked: number;
  imported: number;
  duplicates: number;
  errors: number;
}

interface Candidate {
  file: FoundFile;
  companyId: number;
  size: number;
  mtime: Date;
  hash: string;
  year: number;
  month: number;
  content: Buffer | null;
  metadata: AgentFileMetadata | null;
}

const MAX_ERROR_CONTENT = 5 * 1024 * 1024;

function inPeriod(job: ScanJobPayload, year: number, month: number) {
  if (job.year && year !== job.year) return false;
  if (job.month && month !== job.month) return false;
  return true;
}

/**
 * Executa uma pesquisa:
 *  1. localiza todos os XML das empresas (total real para a barra de progresso);
 *  2. para cada arquivo: cache → SHA-256 → parser → filtro de competência;
 *  3. em lotes: consulta os hashes na API e envia somente o que é novo;
 *  4. um arquivo com problema vira "erro" e o lote continua;
 *  5. o cancelamento é respeitado após o arquivo em processamento.
 */
export async function runScan(ctx: ScanContext, jobId: number, job: ScanJobPayload): Promise<ScanResult> {
  const { api, config, log, cache } = ctx;
  const result: ScanResult = { status: 'DONE', companiesProcessed: 0, filesChecked: 0, imported: 0, duplicates: 0, errors: 0 };
  let cancelRequested = false;
  const stop = () => cancelRequested || ctx.shuttingDown();

  log.info(`Pesquisa iniciada (execução #${job.runId}, ${job.companies.length} empresa(s), período ${job.month ?? 'todos'}/${job.year ?? 'todos'})`);

  // ---------- 1. localização ----------
  const plan: { companyId: number; name: string; files: FoundFile[] }[] = [];
  let totalFiles = 0;
  const notFound: { companyId: number; status: RunCompanyDTO['status']; message: string }[] = [];
  for (const c of job.companies) {
    let dir: string;
    try {
      dir = safeJoin(config.rootPath, c.folderName);
    } catch (e) {
      notFound.push({ companyId: c.companyId, status: 'ERROR', message: (e as Error).message });
      continue;
    }
    if (!isDirectory(dir)) {
      log.warn(`Empresa ${c.companyName}: pasta não encontrada (${c.folderName})`);
      notFound.push({ companyId: c.companyId, status: 'FOLDER_NOT_FOUND', message: `Pasta não encontrada: ${c.folderName}` });
      continue;
    }
    const files = await listXmlFiles(dir);
    plan.push({ companyId: c.companyId, name: c.companyName, files });
    totalFiles += files.length;
    const ctl = await api.progress(jobId, {
      phase: 'ENUMERATING',
      totalFiles,
      filesChecked: 0,
      companyUpdates: [{ companyId: c.companyId, status: 'PENDING', totalFiles: files.length }],
    });
    cancelRequested ||= ctl.cancelRequested;
    if (stop()) break;
  }
  result.companiesProcessed = notFound.length;
  const ctl0 = await api.progress(jobId, {
    phase: 'PROCESSING',
    totalFiles,
    filesChecked: 0,
    companiesProcessed: result.companiesProcessed,
    companyUpdates: notFound.map((n) => ({ companyId: n.companyId, status: n.status, message: n.message })),
  });
  cancelRequested ||= ctl0.cancelRequested;

  // ---------- 2. processamento ----------
  let lastProgressAt = 0;
  const reportProgress = async (currentCompanyId: number | null, force = false) => {
    if (!force && Date.now() - lastProgressAt < 1000) return;
    lastProgressAt = Date.now();
    const ctl = await api.progress(jobId, {
      phase: 'PROCESSING',
      totalFiles,
      filesChecked: result.filesChecked,
      companiesProcessed: result.companiesProcessed,
      currentCompanyId,
    });
    cancelRequested ||= ctl.cancelRequested;
  };

  for (const company of plan) {
    if (stop()) break;
    log.info(`Empresa ${company.name}`);
    log.info(`${company.files.length} arquivos encontrados`);
    const ctl = await api.progress(jobId, {
      phase: 'PROCESSING',
      currentCompanyId: company.companyId,
      companyUpdates: [{ companyId: company.companyId, status: 'RUNNING', totalFiles: company.files.length }],
    });
    cancelRequested ||= ctl.cancelRequested;
    const before = { imported: result.imported, duplicates: result.duplicates, errors: result.errors };

    let pending: Candidate[] = [];
    let pendingBytes = 0;
    let errors: AgentErrorFile[] = [];

    const flush = async () => {
      if (!pending.length && !errors.length) return;
      const known = await api.checkHashes(job.runId, [...new Set(pending.map((p) => p.hash))]);
      const imported: AgentUploadFile[] = [];
      const duplicates: AgentDuplicateFile[] = [];
      for (const p of pending) {
        if (known.has(p.hash)) {
          duplicates.push({
            companyId: p.companyId,
            filename: p.file.name,
            relativePath: p.file.relPath,
            fileHash: p.hash,
            fileSize: p.size,
            fileModifiedAt: p.mtime.toISOString(),
            year: p.year,
            month: p.month,
          });
          continue;
        }
        // novo: garante o conteúdo (veio do cache sem leitura?) e confere o hash
        let content = p.content;
        try {
          if (!content) {
            content = await fsp.readFile(p.file.absPath);
            const h = sha256(content);
            if (h !== p.hash) {
              p.hash = h;
              const parsed = parseXmlFile(content, p.mtime);
              p.metadata = parsed.metadata;
              cache.set(FileCache.key(p.companyId, p.file.relPath), {
                size: content.length,
                mtimeMs: p.mtime.getTime(),
                hash: h,
                year: parsed.metadata.year,
                month: parsed.metadata.month,
              });
            }
          }
          if (!p.metadata) p.metadata = parseXmlFile(content, p.mtime).metadata;
        } catch (e) {
          errors.push({
            companyId: p.companyId,
            filename: p.file.name,
            relativePath: p.file.relPath,
            fileHash: p.hash,
            fileSize: p.size,
            fileModifiedAt: p.mtime.toISOString(),
            errorMessage: (e as Error).message,
            year: p.year,
            month: p.month,
            contentBase64: content && content.length <= MAX_ERROR_CONTENT ? content.toString('base64') : null,
          });
          continue;
        }
        imported.push({
          companyId: p.companyId,
          filename: p.file.name,
          relativePath: p.file.relPath,
          fileHash: p.hash,
          fileSize: content.length,
          fileModifiedAt: p.mtime.toISOString(),
          contentBase64: content.toString('base64'),
          metadata: p.metadata,
        });
      }
      const res = await api.sendFiles(job.runId, { imported, duplicates, errors });
      result.imported += res.imported;
      result.duplicates += res.duplicates;
      result.errors += res.errors;
      cancelRequested ||= res.cancelRequested;
      for (const e of errors) log.error(`${e.relativePath} - ${e.errorMessage}`);
      pending = [];
      pendingBytes = 0;
      errors = [];
    };

    for (const file of company.files) {
      if (stop()) break;
      try {
        const st = await fsp.stat(file.absPath);
        if (st.size > config.maxFileBytes) {
          errors.push({
            companyId: company.companyId,
            filename: file.name,
            relativePath: file.relPath,
            fileHash: null,
            fileSize: st.size,
            fileModifiedAt: st.mtime.toISOString(),
            errorMessage: 'Arquivo acima do tamanho máximo permitido',
            year: st.mtime.getFullYear(),
            month: st.mtime.getMonth() + 1,
          });
        } else {
          const key = FileCache.key(company.companyId, file.relPath);
          const cached = job.fullRescan ? null : cache.get(key, st.size, st.mtimeMs);
          let content: Buffer | null = null;
          let entry = cached;
          let metadata: AgentFileMetadata | null = null;
          if (!entry) {
            content = await fsp.readFile(file.absPath);
            const hash = sha256(content);
            try {
              metadata = parseXmlFile(content, st.mtime).metadata;
              entry = { size: st.size, mtimeMs: st.mtimeMs, hash, year: metadata.year, month: metadata.month, parseError: null };
            } catch (e) {
              entry = {
                size: st.size,
                mtimeMs: st.mtimeMs,
                hash,
                year: st.mtime.getFullYear(),
                month: st.mtime.getMonth() + 1,
                parseError: (e as Error).message,
              };
            }
            cache.set(key, entry);
          }
          if (inPeriod(job, entry.year, entry.month)) {
            if (entry.parseError) {
              content ??= await fsp.readFile(file.absPath).catch(() => null);
              errors.push({
                companyId: company.companyId,
                filename: file.name,
                relativePath: file.relPath,
                fileHash: entry.hash,
                fileSize: st.size,
                fileModifiedAt: st.mtime.toISOString(),
                errorMessage: entry.parseError,
                year: entry.year,
                month: entry.month,
                contentBase64: content && content.length <= MAX_ERROR_CONTENT ? content.toString('base64') : null,
              });
            } else {
              pending.push({
                file,
                companyId: company.companyId,
                size: st.size,
                mtime: st.mtime,
                hash: entry.hash,
                year: entry.year,
                month: entry.month,
                content,
                metadata,
              });
              pendingBytes += content ? content.length : st.size;
            }
          }
        }
      } catch (e) {
        // nenhum erro isolado interrompe o lote
        errors.push({
          companyId: company.companyId,
          filename: file.name,
          relativePath: file.relPath,
          fileHash: null,
          fileSize: null,
          fileModifiedAt: null,
          errorMessage: `Não foi possível ler o arquivo: ${(e as Error).message}`,
        });
      }
      result.filesChecked++;
      if (pending.length >= config.batchMaxFiles || pendingBytes >= config.batchMaxBytes || errors.length >= 200) {
        await flush();
      }
      await reportProgress(company.companyId);
    }
    await flush();
    cache.save();

    const novos = result.imported - before.imported;
    const dup = result.duplicates - before.duplicates;
    const err = result.errors - before.errors;
    log.info(`${novos} arquivos novos`);
    log.info(`${dup} duplicados`);
    if (err) log.warn(`${err} arquivos com erro`);

    const interrupted = stop() && result.filesChecked < totalFiles;
    if (!interrupted) result.companiesProcessed++;
    await api.progress(jobId, {
      phase: 'PROCESSING',
      filesChecked: result.filesChecked,
      companiesProcessed: result.companiesProcessed,
      companyUpdates: [
        {
          companyId: company.companyId,
          status: interrupted ? 'CANCELLED' : 'DONE',
          message: `${novos} novo(s), ${dup} já importado(s), ${err} erro(s)`,
        },
      ],
    });
  }

  cache.save();
  if (cancelRequested) {
    result.status = 'CANCELLED';
    log.warn(`Pesquisa #${job.runId} cancelada após ${result.filesChecked} arquivo(s) verificado(s)`);
  } else if (ctx.shuttingDown()) {
    result.status = 'INTERRUPTED';
    log.warn(`Pesquisa #${job.runId} interrompida pelo encerramento do agente`);
  } else {
    log.info(
      `Pesquisa #${job.runId} finalizada: ${result.filesChecked} verificados, ${result.imported} novos, ${result.duplicates} duplicados, ${result.errors} erros`,
    );
  }
  return result;
}
