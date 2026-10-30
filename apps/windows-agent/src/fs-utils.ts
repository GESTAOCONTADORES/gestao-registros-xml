import { createHash } from 'node:crypto';
import { promises as fsp, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isSafeFolderName } from '@gestao/shared';

/**
 * Junta a raiz com o nome de pasta cadastrado, garantindo que o resultado
 * continue DENTRO da raiz (proteção contra path traversal).
 */
export function safeJoin(root: string, folderName: string): string {
  if (!isSafeFolderName(folderName) || isAbsolute(folderName)) {
    throw new Error(`Nome de pasta inválido: "${folderName}"`);
  }
  const base = resolve(root);
  const target = resolve(base, folderName);
  const rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.includes(sep)) {
    throw new Error(`Pasta fora da raiz monitorada: "${folderName}"`);
  }
  return target;
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export interface FoundFile {
  absPath: string;
  /** Caminho relativo à pasta da empresa, com separador do Windows. */
  relPath: string;
  name: string;
}

/** Lista recursivamente os .xml de uma pasta (não segue atalhos/links simbólicos). */
export async function listXmlFiles(dir: string): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue; // subpasta sem permissão: ignorada
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const abs = join(current, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.xml')) {
        out.push({ absPath: abs, relPath: relative(dir, abs).split(sep).join('\\'), name: e.name });
      }
    }
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Escreve sem sobrescrever: se o nome existir, acrescenta _2, _3... */
export async function writeUnique(dir: string, filename: string, data: Buffer): Promise<string> {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? filename : `${stem}_${i}${ext}`;
    const target = join(dir, name);
    try {
      await fsp.writeFile(target, data, { flag: 'wx' });
      return target;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  throw new Error('Não foi possível definir um nome de arquivo livre');
}
