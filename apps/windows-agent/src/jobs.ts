import { promises as fsp, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { monthFolderName, safeFileName, type AgentJob } from '@gestao/shared';
import { isDirectory, safeJoin, writeUnique } from './fs-utils';
import { runScan, type ScanContext } from './scan';

/** Executa um job recebido da API e informa o resultado. Nunca lança exceção. */
export async function executeJob(ctx: ScanContext, job: AgentJob): Promise<void> {
  const { api, config, log } = ctx;
  try {
    switch (job.type) {
      case 'SCAN': {
        const r = await runScan(ctx, job.id, job.payload);
        await api.complete(job.id, {
          status: r.status === 'INTERRUPTED' ? 'FAILED' : r.status,
          message:
            r.status === 'CANCELLED'
              ? 'Pesquisa cancelada pelo Master'
              : r.status === 'INTERRUPTED'
                ? 'O serviço do agente foi encerrado durante o processamento.'
                : null,
          result: { ...r },
        });
        return;
      }

      case 'CHECK_FOLDERS': {
        const folders = job.payload.companies.map((c) => {
          let exists = false;
          try {
            exists = isDirectory(safeJoin(config.rootPath, c.folderName));
          } catch {
            exists = false;
          }
          return { companyId: c.companyId, exists };
        });
        let unlinked: string[] | undefined;
        if ((job.payload as { listUnlinked?: boolean }).listUnlinked && isDirectory(config.rootPath)) {
          const known = new Set(job.payload.companies.map((c) => c.folderName.toLowerCase()));
          unlinked = readdirSync(config.rootPath, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
            .map((d) => d.name)
            .filter((n) => n.toLowerCase() !== config.reportsFolderName.toLowerCase() && !known.has(n.toLowerCase()))
            .sort((a, b) => a.localeCompare(b));
        }
        log.info(`Verificação de pastas: ${folders.filter((f) => f.exists).length}/${folders.length} encontradas`);
        await api.complete(job.id, { status: 'DONE', result: { folders, unlinked } });
        return;
      }

      case 'CREATE_FOLDER': {
        if (!isDirectory(config.rootPath)) throw new Error('Pasta raiz inacessível');
        const target = safeJoin(config.rootPath, job.payload.folderName);
        if (isDirectory(target)) {
          await api.complete(job.id, { status: 'DONE', message: 'A pasta já existia', result: { path: target } });
          return;
        }
        // um único nível, dentro da raiz, somente após autorização do Master
        await fsp.mkdir(target, { recursive: false });
        log.info(`Pasta criada com autorização do Master: ${target}`);
        await api.complete(job.id, { status: 'DONE', result: { path: target } });
        return;
      }

      case 'SAVE_REPORT': {
        if (!isDirectory(config.rootPath)) throw new Error('Pasta raiz inacessível');
        const pdf = await api.reportPdf(job.payload.reportId);
        const reportsRoot = join(config.rootPath, config.reportsFolderName);
        const dir = join(reportsRoot, String(job.payload.year), monthFolderName(job.payload.month));
        await fsp.mkdir(dir, { recursive: true });
        const name = safeFileName(job.payload.filename).replace(/(\.pdf)?$/i, '.pdf');
        const saved = await writeUnique(dir, name, pdf);
        log.info(`Relatório salvo: ${saved}`);
        await api.complete(job.id, { status: 'DONE', result: { drivePath: saved } });
        return;
      }

      default:
        throw new Error(`Tipo de job desconhecido: ${(job as { type: string }).type}`);
    }
  } catch (e) {
    const message = (e as Error).message || String(e);
    log.error(`Job #${job.id} (${job.type}) falhou: ${message}`);
    await api.complete(job.id, { status: 'FAILED', message }).catch((err: Error) => log.error(`Não foi possível informar a falha: ${err.message}`));
  }
}
