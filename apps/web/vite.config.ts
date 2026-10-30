import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Preenche %API_ORIGIN% do public/_headers (CSP connect-src) com a origem de VITE_API_URL,
 * para o Cloudflare Pages liberar as chamadas à API sem edição manual.
 */
function apiOriginInHeaders(apiUrl: string): Plugin {
  return {
    name: 'api-origin-in-headers',
    apply: 'build',
    closeBundle() {
      const file = resolve(__dirname, 'dist', '_headers');
      let origin = '';
      try {
        origin = new URL(apiUrl).origin;
      } catch {
        throw new Error(`VITE_API_URL inválida: "${apiUrl}"`);
      }
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('%API_ORIGIN%', origin));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, __dirname, 'VITE_'), ...process.env };
  const apiUrl = env.VITE_API_URL || 'http://localhost:3333';
  return {
    plugins: [react(), tailwindcss(), apiOriginInHeaders(apiUrl)],
    // o pacote compartilhado do monorepo é consumido direto do código-fonte TS
    optimizeDeps: { exclude: ['@gestao/shared'] },
    server: { port: 5173 },
    build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
  };
});
