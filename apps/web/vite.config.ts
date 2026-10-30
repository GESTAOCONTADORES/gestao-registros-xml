import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // o pacote compartilhado do monorepo é consumido direto do código-fonte TS
  optimizeDeps: { exclude: ['@gestao/shared'] },
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
});
