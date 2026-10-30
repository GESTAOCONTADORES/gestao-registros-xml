import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestEnv, MASTER, type TestEnv } from './helpers';

let env: TestEnv;
const web = mkdtempSync(join(tmpdir(), 'dp-web-'));

beforeAll(async () => {
  mkdirSync(join(web, 'assets'), { recursive: true });
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>REGISTROS XML-PDF</title><div id="root"></div>');
  writeFileSync(join(web, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(tmpdir(), 'segredo-fora-do-site.txt'), 'nao pode vazar');
  env = await createTestEnv({ WEB_DIST_DIR: web });
});
afterAll(async () => {
  await env.close();
  rmSync(web, { recursive: true, force: true });
});

const html = { accept: 'text/html,application/xhtml+xml' };

describe('site servido pela própria API (instalação local / teste)', () => {
  it('entrega o site na raiz e nas rotas do sistema (SPA)', async () => {
    for (const url of ['/', '/registros', '/historico/12', '/login']) {
      const res = await env.app.inject({ method: 'GET', url, headers: html });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('REGISTROS XML-PDF');
      expect(res.headers['content-security-policy']).toContain("connect-src 'self'");
    }
  });

  it('entrega os arquivos do build com cache longo', async () => {
    const res = await env.app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('as rotas da API continuam respondendo JSON', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/health' })).json().ok).toBe(true);
    const unknown = await env.app.inject({ method: 'GET', url: '/rota-inexistente.json' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe('NOT_FOUND');
    expect((await env.app.inject({ method: 'GET', url: '/records' })).statusCode).toBe(401);
  });

  it('não permite ler arquivos fora da pasta do site', async () => {
    for (const url of ['/../segredo-fora-do-site.txt', '/..%2fsegredo-fora-do-site.txt', '/assets/..%2f..%2fsegredo-fora-do-site.txt']) {
      const res = await env.app.inject({ method: 'GET', url, headers: html });
      expect(res.body).not.toContain('nao pode vazar');
    }
  });

  it('login a partir do próprio endereço funciona; origem estranha continua bloqueada', async () => {
    const ok = await env.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: MASTER,
      headers: { origin: 'https://teste-abc.trycloudflare.com', host: 'teste-abc.trycloudflare.com' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://teste-abc.trycloudflare.com');
    const bad = await env.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: MASTER,
      headers: { origin: 'https://evil.example', host: 'teste-abc.trycloudflare.com' },
    });
    expect(bad.statusCode).toBe(403);
  });
});
