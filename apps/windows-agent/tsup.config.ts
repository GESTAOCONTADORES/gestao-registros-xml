import { defineConfig } from 'tsup';

// Gera um único arquivo autocontido (dist/agent.cjs): basta copiar para o Windows e executar com Node.js.
export default defineConfig({
  entry: { agent: 'src/index.ts' },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  noExternal: [/.*/],
  outExtension: () => ({ js: '.cjs' }),
});
