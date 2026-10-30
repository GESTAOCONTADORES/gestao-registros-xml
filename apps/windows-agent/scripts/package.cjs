/**
 * Monta a pasta de distribuição do agente para copiar ao computador Windows:
 *   release/GestaoXmlAgent/{dist/agent.cjs, scripts/*, .env.example, LEIA-ME.txt, package.json}
 */
const fs = require('node:fs');
const path = require('node:path');

const base = path.resolve(__dirname, '..');
const out = path.join(base, 'release', 'GestaoXmlAgent');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'dist'), { recursive: true });
fs.mkdirSync(path.join(out, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(base, 'dist', 'agent.cjs'), path.join(out, 'dist', 'agent.cjs'));
for (const f of ['install-service.cjs', 'uninstall-service.cjs', 'install-task.ps1', 'uninstall-task.ps1', 'start-agent.cmd']) {
  fs.copyFileSync(path.join(base, 'scripts', f), path.join(out, 'scripts', f));
}
fs.copyFileSync(path.join(base, '.env.example'), path.join(out, '.env.example'));
fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify({ name: 'gestao-xml-agent', private: true, version: '1.0.0', description: 'Gestão XML Agent' }, null, 2),
);
fs.writeFileSync(
  path.join(out, 'LEIA-ME.txt'),
  [
    'Gestão XML Agent — Departamento Pessoal / REGISTROS XML-PDF',
    '',
    '1. Instale o Node.js 20 LTS ou superior (https://nodejs.org).',
    '2. Copie .env.example para .env e preencha API_URL, AGENT_API_TOKEN e ROOT_PATH.',
    '3. Teste: scripts\\start-agent.cmd  (deve aparecer "Gestão XML Agent iniciado").',
    '4. Instale em segundo plano (recomendado com Google Drive):',
    '     powershell -ExecutionPolicy Bypass -File scripts\\install-task.ps1',
    '   ou como Serviço do Windows:',
    '     npm install node-windows@1.0.0-beta.8',
    '     node scripts\\install-service.cjs',
    '',
    'Guia completo: docs/AGENTE-WINDOWS.md no repositório.',
  ].join('\r\n'),
);
console.log(`Pacote do agente gerado em ${out}`);
