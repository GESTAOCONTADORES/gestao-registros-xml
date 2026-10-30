import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

// Mesma política do public/_headers do Cloudflare Pages, com a API no próprio endereço
const SITE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

/**
 * Serve o site (build do apps/web) pela própria API — usado na instalação local / de teste.
 * Arquivos existentes são entregues; demais rotas GET de navegação recebem o index.html (SPA).
 */
export function createWebHandler(webDir: string) {
  const root = resolve(webDir);

  const send = async (reply: FastifyReply, file: string) => {
    const body = await readFile(file);
    const isAsset = file.includes(`${sep}assets${sep}`);
    return reply
      .code(200)
      .header('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
      .header('Content-Security-Policy', SITE_CSP)
      .header('Cache-Control', isAsset ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(body);
  };

  return async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    } catch {
      return false;
    }
    const target = resolve(root, `.${pathname}`);
    // nunca fora da pasta do site (path traversal)
    if (target !== root && !target.startsWith(root + sep)) return false;
    if (extname(pathname)) {
      try {
        if ((await stat(target)).isFile()) {
          await send(reply, target);
          return true;
        }
      } catch {
        // arquivo inexistente
      }
      return false;
    }
    if (!String(req.headers.accept ?? '').includes('text/html')) return false;
    await send(reply, join(root, 'index.html'));
    return true;
  };
}
