import { mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FileCache } from '../src/cache';
import { loadConfig } from '../src/config';
import { listXmlFiles, safeJoin, writeUnique } from '../src/fs-utils';
import { createLogger } from '../src/logger';

const tmp = mkdtempSync(join(tmpdir(), 'agent-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('segurança de caminhos', () => {
  it('safeJoin aceita somente uma pasta direta dentro da raiz', () => {
    expect(safeJoin(tmp, 'EMPRESA A')).toBe(join(tmp, 'EMPRESA A'));
    for (const bad of ['..', '../x', 'a/b', 'a\\b', '/etc', 'C:\\Windows', 'C:', '', 'con', 'pasta.']) {
      expect(() => safeJoin(tmp, bad)).toThrow();
    }
  });

  it('exige HTTPS para a API fora de localhost', () => {
    const base = { AGENT_API_TOKEN: 'x'.repeat(30) };
    expect(() => loadConfig({ ...base, API_URL: 'http://api.exemplo.com.br' })).toThrow(/HTTPS/);
    expect(loadConfig({ ...base, API_URL: 'https://api.exemplo.com.br/' }).apiUrl).toBe('https://api.exemplo.com.br');
    expect(loadConfig({ ...base, API_URL: 'http://localhost:3333' }).apiUrl).toBe('http://localhost:3333');
    expect(() => loadConfig({ API_URL: 'https://a.b', AGENT_API_TOKEN: 'curto' })).toThrow(/AGENT_API_TOKEN/);
  });
});

describe('arquivos', () => {
  it('lista somente .xml, recursivamente, com caminho relativo no padrão Windows', async () => {
    const dir = join(tmp, 'EMP');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(dir, 'sub', 'deep'), { recursive: true });
    writeFileSync(join(dir, 'a.xml'), '<a/>');
    writeFileSync(join(dir, 'sub', 'deep', 'B.XML'), '<b/>');
    writeFileSync(join(dir, 'c.pdf'), 'x');
    writeFileSync(join(dir, '~$temp.xml'), 'x');
    const files = await listXmlFiles(dir);
    expect(files.map((f) => f.relPath)).toEqual(['a.xml', 'sub\\deep\\B.XML']);
  });

  it('nunca sobrescreve um relatório existente', async () => {
    const a = await writeUnique(tmp, 'Relatorio.pdf', Buffer.from('1'));
    const b = await writeUnique(tmp, 'Relatorio.pdf', Buffer.from('2'));
    expect(a.endsWith('Relatorio.pdf')).toBe(true);
    expect(b.endsWith('Relatorio_2.pdf')).toBe(true);
    expect(readFileSync(a, 'utf8')).toBe('1');
  });

  it('cache incremental só é reaproveitado se tamanho e data não mudaram', () => {
    const file = join(tmp, 'cache.json');
    const c = new FileCache(file);
    const key = FileCache.key(1, 'A.xml');
    c.set(key, { size: 10, mtimeMs: 1000, hash: 'h', year: 2026, month: 10 });
    c.save();
    const c2 = new FileCache(file);
    expect(c2.get(FileCache.key(1, 'a.XML'), 10, 1000)?.hash).toBe('h');
    expect(c2.get(key, 11, 1000)).toBeNull();
    expect(c2.get(key, 10, 2000)).toBeNull();
  });
});

describe('logs', () => {
  it('formato "AAAA-MM-DD hh:mm:ss NÍVEL mensagem" com rotação e retenção', () => {
    const dir = join(tmp, 'logs');
    const old = join(dir, 'agent-2020-01-01.log');
    const { mkdirSync } = require('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(old, 'antigo');
    const past = new Date('2020-01-01');
    utimesSync(old, past, past);
    const log = createLogger(dir, 30, false);
    log.info('Pesquisa iniciada');
    log.error('arquivo.xml - XML inválido');
    const files = readdirSync(dir);
    expect(files).not.toContain('agent-2020-01-01.log');
    const content = readFileSync(join(dir, files[0]!), 'utf8').trim().split('\n');
    expect(content[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} INFO Pesquisa iniciada$/);
    expect(content[1]).toMatch(/ERROR arquivo\.xml - XML inválido$/);
  });
});
