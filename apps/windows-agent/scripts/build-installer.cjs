/**
 * Gera o instalador do agente: release/GestaoXmlAgent-Setup-<versão>.exe
 *
 * Requisitos: NSIS 3 (makensis) e curl + unzip (Linux/macOS) ou PowerShell (Windows).
 *   Ubuntu:  sudo apt-get install nsis
 *   Windows: https://nsis.sourceforge.io  (ou defina MAKENSIS=C:\...\makensis.exe)
 *
 * O Node.js oficial (win-x64) é baixado de nodejs.org e conferido por SHA-256.
 * Assinatura de código opcional: SIGN_PFX=<arquivo.pfx> SIGN_PASSWORD=<senha> (usa osslsigncode).
 */
const { execFileSync, execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const NODE_VERSION = process.env.AGENT_NODE_VERSION || '22.22.0';
// SHA-256 oficial de node-v22.22.0-win-x64.zip (https://nodejs.org/dist/v22.22.0/SHASUMS256.txt)
const NODE_ZIP_SHA256 =
  process.env.AGENT_NODE_SHA256 || 'c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a';

const base = path.resolve(__dirname, '..');
const pkg = require(path.join(base, 'package.json'));
const version = pkg.version;
const cacheDir = path.join(base, 'installer', '.cache');
const buildDir = path.join(base, 'installer', 'build');
const payload = path.join(buildDir, 'payload');
const releaseDir = path.join(base, 'release');
const isWin = process.platform === 'win32';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// 1. build do agente
console.log('› Compilando o agente...');
execSync('npm run build', { cwd: base, stdio: 'inherit' });

// 2. Node.js para Windows (com cache)
fs.mkdirSync(cacheDir, { recursive: true });
const zipName = `node-v${NODE_VERSION}-win-x64.zip`;
const zipPath = path.join(cacheDir, zipName);
if (!fs.existsSync(zipPath) || sha256(zipPath) !== NODE_ZIP_SHA256) {
  console.log(`› Baixando ${zipName}...`);
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${zipName}`;
  if (isWin) run('powershell', ['-NoProfile', '-Command', `Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}'`]);
  else run('curl', ['-fsSL', '--retry', '3', '-o', zipPath, url]);
}
const got = sha256(zipPath);
if (got !== NODE_ZIP_SHA256) {
  fs.rmSync(zipPath, { force: true });
  throw new Error(`SHA-256 do Node.js não confere (esperado ${NODE_ZIP_SHA256}, obtido ${got}). Download descartado.`);
}

// 3. monta o conteúdo do instalador
console.log('› Montando o pacote...');
fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(path.join(payload, 'node'), { recursive: true });
fs.mkdirSync(path.join(payload, 'dist'), { recursive: true });
fs.mkdirSync(path.join(payload, 'scripts'), { recursive: true });
const extractDir = path.join(buildDir, 'node-extract');
fs.mkdirSync(extractDir, { recursive: true });
const inZip = [`node-v${NODE_VERSION}-win-x64/node.exe`, `node-v${NODE_VERSION}-win-x64/LICENSE`];
if (isWin) {
  run('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`]);
} else {
  run('unzip', ['-q', '-o', zipPath, ...inZip, '-d', extractDir]);
}
for (const f of inZip) {
  fs.copyFileSync(path.join(extractDir, f), path.join(payload, 'node', path.basename(f)));
}
fs.rmSync(extractDir, { recursive: true, force: true });

fs.copyFileSync(path.join(base, 'dist', 'agent.cjs'), path.join(payload, 'dist', 'agent.cjs'));
for (const f of ['launcher.ps1', 'iniciar-agente.ps1', 'parar-agente.ps1', 'testar-conexao.cmd']) {
  fs.copyFileSync(path.join(base, 'scripts', f), path.join(payload, 'scripts', f));
}
fs.copyFileSync(path.join(base, '.env.example'), path.join(payload, '.env.example'));
fs.writeFileSync(
  path.join(payload, 'LEIA-ME.txt'),
  [
    `Gestão XML Agent ${version} — Departamento Pessoal / REGISTROS XML-PDF`,
    '',
    'Menu Iniciar > Gestão XML Agent:',
    '  Iniciar agente / Parar agente',
    '  Testar conexão      - confere a pasta e a comunicação com o sistema',
    '  Abrir logs          - registros técnicos (um arquivo por dia)',
    '  Editar configuração - endereço da API, token e pasta (depois: Parar e Iniciar)',
    '',
    'O agente inicia sozinho ao entrar no Windows e roda sem janela.',
    `Inclui Node.js ${NODE_VERSION} (licença em node\\LICENSE).`,
  ].join('\r\n'),
);

// 4. compila com NSIS
fs.mkdirSync(releaseDir, { recursive: true });
const outFile = path.join(releaseDir, `GestaoXmlAgent-Setup-${version}.exe`);
const makensis = process.env.MAKENSIS || 'makensis';
console.log('› Gerando o instalador...');
run(makensis, [
  '-V2',
  '-WX',
  `-DVERSION=${version}`,
  `-DPAYLOAD=${payload}`,
  `-DOUTFILE=${outFile}`,
  path.join(base, 'installer', 'GestaoXmlAgent.nsi'),
]);

// 5. assinatura opcional
if (process.env.SIGN_PFX) {
  console.log('› Assinando o instalador...');
  const signed = `${outFile}.signed`;
  run('osslsigncode', [
    'sign', '-pkcs12', process.env.SIGN_PFX, '-pass', process.env.SIGN_PASSWORD || '',
    '-n', 'Gestão XML Agent', '-t', 'http://timestamp.digicert.com', '-h', 'sha256',
    '-in', outFile, '-out', signed,
  ]);
  fs.renameSync(signed, outFile);
}

const size = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
console.log(`\n✔ Instalador gerado: ${outFile} (${size} MB)`);
console.log(`  SHA-256: ${sha256(outFile)}`);
