import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CacheEntry {
  size: number;
  mtimeMs: number;
  hash: string;
  year: number;
  month: number;
  parseError?: string | null;
}

/**
 * Cache incremental local: caminho + tamanho + data → hash e competência.
 * Evita reler arquivos que não mudaram. A decisão de duplicidade continua
 * sendo SEMPRE pelo SHA-256 consultado na API (validação final).
 */
export class FileCache {
  private entries: Record<string, CacheEntry> = {};
  private dirty = false;

  constructor(private file: string) {
    try {
      if (existsSync(file)) {
        const data = JSON.parse(readFileSync(file, 'utf8')) as { version: number; entries: Record<string, CacheEntry> };
        if (data.version === 1 && data.entries) this.entries = data.entries;
      }
    } catch {
      this.entries = {}; // cache corrompido: recomeça
    }
  }

  static key(companyId: number, relPath: string) {
    return `${companyId}|${relPath.toLowerCase()}`;
  }

  get(key: string, size: number, mtimeMs: number): CacheEntry | null {
    const e = this.entries[key];
    return e && e.size === size && Math.abs(e.mtimeMs - mtimeMs) < 1 ? e : null;
  }

  set(key: string, entry: CacheEntry) {
    this.entries[key] = entry;
    this.dirty = true;
  }

  save() {
    if (!this.dirty) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), entries: this.entries }));
    renameSync(tmp, this.file);
    this.dirty = false;
  }
}
