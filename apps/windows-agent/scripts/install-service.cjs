/**
 * Instala o Gestão XML Agent como Serviço do Windows (via node-windows/WinSW).
 *
 * Uso (PowerShell como Administrador, na pasta do agente):
 *   npm install node-windows@1.0.0-beta.8
 *   $env:SERVICE_ACCOUNT="DOMINIO\usuario"; $env:SERVICE_PASSWORD="..."   # recomendado (ver docs/AGENTE-WINDOWS.md)
 *   node scripts\install-service.cjs
 *
 * IMPORTANTE: a unidade G: do Google Drive para computador existe apenas na sessão
 * do usuário que fez login no Drive. Rode o serviço COM A CONTA desse usuário
 * (SERVICE_ACCOUNT/SERVICE_PASSWORD) ou use a Tarefa Agendada (install-task.ps1).
 */
const path = require('node:path');
const fs = require('node:fs');

let Service;
try {
  ({ Service } = require('node-windows'));
} catch {
  console.error('Pacote node-windows não encontrado. Execute: npm install node-windows@1.0.0-beta.8');
  process.exit(1);
}

const base = path.resolve(__dirname, '..');
const script = path.join(base, 'dist', 'agent.cjs');
if (!fs.existsSync(script)) {
  console.error(`Arquivo não encontrado: ${script}. Copie o build (dist\\agent.cjs) para esta pasta.`);
  process.exit(1);
}
if (!fs.existsSync(path.join(base, '.env'))) {
  console.error('Crie o arquivo .env (a partir de .env.example) antes de instalar o serviço.');
  process.exit(1);
}

const svc = new Service({
  name: 'GestaoXmlAgent',
  description: 'Gestão XML Agent — Departamento Pessoal / REGISTROS XML-PDF',
  script,
  workingDirectory: base,
  wait: 5,
  grow: 0.5,
  maxRestarts: 20,
  stopparentfirst: true,
});

if (process.env.SERVICE_ACCOUNT) {
  const [domain, account] = process.env.SERVICE_ACCOUNT.includes('\\')
    ? process.env.SERVICE_ACCOUNT.split('\\')
    : ['.', process.env.SERVICE_ACCOUNT];
  svc.logOnAs.domain = domain;
  svc.logOnAs.account = account;
  svc.logOnAs.password = process.env.SERVICE_PASSWORD || '';
} else {
  console.warn('AVISO: SERVICE_ACCOUNT não definido — o serviço rodará como LocalSystem e provavelmente NÃO verá a unidade G:.');
}

svc.on('install', () => {
  console.log('Serviço "GestaoXmlAgent" instalado. Iniciando...');
  svc.start();
});
svc.on('alreadyinstalled', () => console.log('O serviço já está instalado.'));
svc.on('start', () => console.log('Serviço iniciado. Verifique no sistema web: "Agente XML ● Online".'));
svc.on('error', (e) => console.error('Erro:', e));
svc.install();
