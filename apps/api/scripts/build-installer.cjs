/**
 * Gera o instalador do servidor: apps/api/release/GestaoXmlServidor-Setup-<versão>.exe
 *
 * Conteúdo: Node.js (win-x64), API (dist + dependências de produção para Windows),
 * WinSW (serviço do Windows), cloudflared (Cloudflare Tunnel), scripts de administração
 * e o instalador do Gestão XML Agent.
 * Requisitos: NSIS 3 (makensis), curl e unzip (Linux) — iguais aos do instalador do agente.
 * Todos os binários de terceiros são conferidos por SHA-256.
 */
const { execFileSync, execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const NODE_VERSION = '22.22.0';
const NODE_ZIP_SHA256 = 'c97fa376d2becdc8863fcd3ca2dd9a83a9f3468ee7ccf7a6d076ec66a645c77a';
const BINARIES = [
  {
    // https://github.com/winsw/winsw (MIT) — requer .NET Framework 4.6.1+ (já presente no Windows 10/11)
    file: 'WinSW.NET461.exe',
    url: 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe',
    sha256: 'b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f',
  },
  {
    // https://github.com/cloudflare/cloudflared (Apache-2.0)
    file: 'cloudflared-2026.9.2.exe',
    url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.9.2/cloudflared-windows-amd64.exe',
    sha256: '214f5d74f66941d147d054f6cc9d821c60ff6a9b2d5355f6c854c6bee217c548',
  },
];

const apiDir = path.resolve(__dirname, '..');
const root = path.resolve(apiDir, '..', '..');
const agentDir = path.join(root, 'apps', 'windows-agent');
const version = require(path.join(apiDir, 'package.json')).version;
const cacheDir = path.join(apiDir, 'installer', '.cache');
const agentCache = path.join(agentDir, 'installer', '.cache');
const buildDir = path.join(apiDir, 'installer', 'build');
const payload = path.join(buildDir, 'payload');
const releaseDir = path.join(apiDir, 'release');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const copyDir = (from, to) => fs.cpSync(from, to, { recursive: true });

function download(url, dest, expected) {
  if (!fs.existsSync(dest) || sha256(dest) !== expected) {
    console.log(`› Baixando ${path.basename(url)}...`);
    run('curl', ['-fsSL', '--retry', '3', '-o', dest, url]);
  }
  const got = sha256(dest);
  if (got !== expected) {
    fs.rmSync(dest, { force: true });
    throw new Error(`SHA-256 não confere para ${url} (esperado ${expected}, obtido ${got})`);
  }
}

// 1. builds: API e instalador do agente
console.log('› Compilando a API...');
execSync('npm run build', { cwd: apiDir, stdio: 'inherit' });
console.log('› Gerando o instalador do agente...');
execSync('npm run installer', { cwd: agentDir, stdio: 'inherit' });
const agentVersion = require(path.join(agentDir, 'package.json')).version;
const agentSetup = path.join(agentDir, 'release', `GestaoXmlAgent-Setup-${agentVersion}.exe`);

// site servido pela própria API (http://localhost:3333 e link de teste)
console.log('› Compilando o site (mesmo endereço da API)...');
execSync('npm run build -w @gestao/web', { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_API_URL: 'same-origin' } });

// 2. binários de terceiros
fs.mkdirSync(cacheDir, { recursive: true });
for (const b of BINARIES) download(b.url, path.join(cacheDir, b.file), b.sha256);
const nodeZip = path.join(agentCache, `node-v${NODE_VERSION}-win-x64.zip`);
download(`https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`, nodeZip, NODE_ZIP_SHA256);

// 3. monta o conteúdo
console.log('› Montando o pacote...');
fs.rmSync(buildDir, { recursive: true, force: true });
for (const d of ['node', 'app', 'web', 'service', 'tools', 'scripts', 'cloudflared', 'agente']) {
  fs.mkdirSync(path.join(payload, d), { recursive: true });
}
const extract = path.join(buildDir, 'node-extract');
const inZip = [`node-v${NODE_VERSION}-win-x64/node.exe`, `node-v${NODE_VERSION}-win-x64/LICENSE`];
run('unzip', ['-q', '-o', nodeZip, ...inZip, '-d', extract]);
for (const f of inZip) fs.copyFileSync(path.join(extract, f), path.join(payload, 'node', path.basename(f)));
fs.rmSync(extract, { recursive: true, force: true });

// API: dist + dependências de produção para Windows x64 (inclui binário nativo do Argon2)
const app = path.join(payload, 'app');
copyDir(path.join(apiDir, 'dist'), path.join(app, 'dist'));
for (const f of fs.readdirSync(path.join(app, 'dist'))) if (f.endsWith('.map')) fs.rmSync(path.join(app, 'dist', f));
const installed = (name) => require(path.join(root, 'node_modules', name, 'package.json')).version;
const deps = {};
for (const pkgDir of ['apps/api', 'packages/database', 'packages/xml-parser', 'packages/shared']) {
  const pkg = require(path.join(root, pkgDir, 'package.json'));
  for (const name of Object.keys(pkg.dependencies ?? {})) if (!name.startsWith('@gestao/')) deps[name] = installed(name);
}
fs.writeFileSync(
  path.join(app, 'package.json'),
  JSON.stringify({ name: 'gestao-xml-api', private: true, version, type: 'module', dependencies: deps }, null, 2),
);
console.log('› Instalando dependências da API para Windows x64...');
run('npm', ['install', '--omit=dev', '--os=win32', '--cpu=x64', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: app });
if (!fs.existsSync(path.join(app, 'node_modules', '@node-rs', 'argon2-win32-x64-msvc'))) {
  throw new Error('Binário do Argon2 para Windows não foi instalado');
}
fs.mkdirSync(path.join(app, 'assets'), { recursive: true });
const logo = path.join(root, 'apps', 'web', 'public', 'assets', 'logo-gestao-contadores.png');
if (fs.existsSync(logo)) fs.copyFileSync(logo, path.join(app, 'assets', 'logo-gestao-contadores.png'));

copyDir(path.join(root, 'apps', 'web', 'dist'), path.join(payload, 'web'));
if (!fs.readFileSync(path.join(payload, 'web', '_headers'), 'utf8').includes("connect-src 'self';")) {
  throw new Error('Build do site não está no modo same-origin');
}
fs.copyFileSync(path.join(cacheDir, 'WinSW.NET461.exe'), path.join(payload, 'service', 'GestaoXmlApi.exe'));
fs.copyFileSync(path.join(cacheDir, BINARIES[1].file), path.join(payload, 'cloudflared', 'cloudflared.exe'));
fs.copyFileSync(path.join(apiDir, 'installer', 'tools', 'setup.cjs'), path.join(payload, 'tools', 'setup.cjs'));
for (const f of fs.readdirSync(path.join(apiDir, 'installer', 'scripts'))) {
  fs.copyFileSync(path.join(apiDir, 'installer', 'scripts', f), path.join(payload, 'scripts', f));
}
fs.copyFileSync(agentSetup, path.join(payload, 'agente', 'GestaoXmlAgent-Setup.exe'));
fs.writeFileSync(
  path.join(payload, 'LEIA-ME.txt'),
  [
    `Gestão XML Servidor ${version} — Departamento Pessoal / REGISTROS XML-PDF`,
    '',
    'Serviço do Windows: GestaoXmlApi (inicia com o Windows, reinicia sozinho em falhas).',
    'Dados, configuração (.env), logs e backups: C:\\ProgramData\\GestaoXmlServidor',
    'Menu Iniciar > Gestão XML Servidor: status, reiniciar, backup, restaurar, configuração, dados de acesso.',
    '',
    `Inclui: Node.js ${NODE_VERSION} (node\\LICENSE), WinSW 2.12.0 (MIT), cloudflared 2026.9.2 (Apache-2.0).`,
  ].join('\r\n'),
);

// 4. NSIS
fs.mkdirSync(releaseDir, { recursive: true });
const outFile = path.join(releaseDir, `GestaoXmlServidor-Setup-${version}.exe`);
console.log('› Gerando o instalador...');
run(process.env.MAKENSIS || 'makensis', [
  '-V2',
  '-WX',
  `-DVERSION=${version}`,
  `-DPAYLOAD=${payload}`,
  `-DOUTFILE=${outFile}`,
  path.join(apiDir, 'installer', 'GestaoXmlServidor.nsi'),
]);

if (process.env.SIGN_PFX) {
  const signed = `${outFile}.signed`;
  run('osslsigncode', [
    'sign', '-pkcs12', process.env.SIGN_PFX, '-pass', process.env.SIGN_PASSWORD || '',
    '-n', 'Gestão XML Servidor', '-t', 'http://timestamp.digicert.com', '-h', 'sha256', '-in', outFile, '-out', signed,
  ]);
  fs.renameSync(signed, outFile);
}

console.log(`\n✔ Instalador gerado: ${outFile} (${(fs.statSync(outFile).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  SHA-256: ${sha256(outFile)}`);
