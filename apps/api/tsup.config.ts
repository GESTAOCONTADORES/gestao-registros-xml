import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/maintenance.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // pacotes do monorepo são embutidos; dependências de terceiros ficam em node_modules
  noExternal: [/^@gestao\//],
  external: ['pdfkit', '@node-rs/argon2', '@electric-sql/pglite', 'pg'],
  // migrations SQL acompanham o build (dist/migrations)
  async onSuccess() {
    cpSync('../../packages/database/migrations', 'dist/migrations', { recursive: true });
  },
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});
