/**
 * Gestão XML — Servidor: configuração usada pelo instalador.
 *
 *   node setup.cjs configure --data "<pasta de dados>" --app "<pasta da aplicação>" --site "<url do site>" --master-password-file "<arquivo>"
 *   node setup.cjs wait-health --port 3333 --timeout 90
 *
 * - Na primeira instalação cria o .env com segredos aleatórios (JWT e token do agente).
 * - Em atualizações preserva os segredos e só ajusta o endereço do site.
 * - Grava DADOS-DE-ACESSO.txt e agent-token.txt na pasta de dados.
 * Resultado/erros também em <data>\setup-resultado.txt (o instalador lê esse arquivo).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const secret = () => crypto.randomBytes(48).toString('base64url');

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
  return out;
}

function normalizeSites(raw) {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .filter((s) => /^https?:\/\/[^/]+$/i.test(s));
}

function configure() {
  const data = opt('data');
  const app = opt('app');
  if (!data || !app) throw new Error('Parâmetros --data e --app são obrigatórios');
  fs.mkdirSync(data, { recursive: true });
  for (const d of ['db', 'backups', 'logs']) fs.mkdirSync(path.join(data, d), { recursive: true });
  const envFile = path.join(data, '.env');
  const current = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : null;

  const sites = normalizeSites(opt('site') || (current && current.CORS_ORIGINS) || '');
  let masterPassword = '';
  const pwFile = opt('master-password-file');
  if (pwFile && fs.existsSync(pwFile)) {
    masterPassword = fs.readFileSync(pwFile, 'utf8').replace(/^\uFEFF/, '').trim();
    fs.rmSync(pwFile, { force: true }); // não deixa a senha em arquivo temporário
  }

  const env = {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: '3333',
    APP_PUBLIC_URL: sites[0] || '',
    CORS_ORIGINS: sites.join(','),
    TRUST_PROXY: 'true',
    DATABASE_URL: `pglite://${path.join(data, 'db')}`,
    BACKUP_DIR: path.join(data, 'backups'),
    BACKUP_KEEP: '30',
    JWT_ACCESS_SECRET: secret(),
    COOKIE_SECURE: 'true',
    COOKIE_SAMESITE: 'none',
    AGENT_API_TOKEN: secret(),
    MASTER_NAME: 'Departamento pessoal',
    MASTER_DEPARTMENT: 'Departamento Pessoal',
    MASTER_INITIAL_PASSWORD: masterPassword || 'DP102030',
    LOGO_PATH: path.join(app, 'assets', 'logo-gestao-contadores.png'),
    // site servido pela própria API em http://localhost:3333 (teste local / link de teste)
    WEB_DIST_DIR: path.join(app, '..', 'web'),
    SMTP_HOST: '',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    SMTP_FROM: '',
    DP_APPROVAL_EMAIL: '',
    ...(current || {}),
  };
  // em atualizações: segredos e e-mail preservados; o site informado agora prevalece
  if (sites.length) {
    env.CORS_ORIGINS = sites.join(',');
    env.APP_PUBLIC_URL = sites[0];
  }
  env.DATABASE_URL = (current && current.DATABASE_URL) || env.DATABASE_URL;

  const lines = [
    '# Gestão XML — Servidor (API). Gerado pelo instalador.',
    '# Após alterar: Menu Iniciar > Gestão XML Servidor > Reiniciar servidor',
    '# Nunca compartilhe este arquivo: contém segredos.',
    // aspas simples: valor literal (caminhos do Windows têm "\")
    ...Object.entries(env).map(([k, v]) => `${k}=${/[\s#"'\\]/.test(v) ? `'${v}'` : v}`),
  ];
  fs.writeFileSync(envFile, lines.join('\r\n') + '\r\n');
  fs.writeFileSync(path.join(data, 'agent-token.txt'), env.AGENT_API_TOKEN);

  const info = [
    'GESTÃO XML — DADOS DE ACESSO (guarde em local seguro)',
    '======================================================',
    '',
    'Sistema (site): ' + (env.APP_PUBLIC_URL || '(informar no instalador ou no .env: CORS_ORIGINS)'),
    'Login inicial:  Departamento pessoal',
    'Senha inicial:  a informada na instalação (padrão DP102030) — troque no primeiro acesso.',
    '',
    'Sistema neste computador (teste): http://localhost:3333',
    'API neste computador:  http://localhost:3333   (teste: http://localhost:3333/health)',
    'API pela internet:     o endereço público configurado no Cloudflare Tunnel (https://...)',
    '',
    'TOKEN DO AGENTE (use no instalador do Gestão XML Agent):',
    env.AGENT_API_TOKEN,
    '',
    'Agente neste mesmo computador: Endereço da API = http://localhost:3333',
    'Agente em outro computador:    Endereço da API = endereço público https://...',
    '',
    `Configuração: ${envFile}`,
    `Backups diários: ${env.BACKUP_DIR}`,
  ];
  fs.writeFileSync(path.join(data, 'DADOS-DE-ACESSO.txt'), '\uFEFF' + info.join('\r\n') + '\r\n');
  const result = `OK\r\n${current ? 'atualizado' : 'criado'}\r\n`;
  fs.writeFileSync(path.join(data, 'setup-resultado.txt'), result);
  if (opt('result')) fs.writeFileSync(opt('result'), result);
}

function waitHealth() {
  const port = Number(opt('port', '3333'));
  const deadline = Date.now() + Number(opt('timeout', '90')) * 1000;
  const out = opt('out');
  const done = (ok, msg) => {
    if (out) fs.writeFileSync(out, `${ok ? 'OK' : 'ERRO'}\r\n${msg}\r\n`);
    process.exit(ok ? 0 : 1);
  };
  const attempt = () => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 3000 }, (res) => {
      res.resume();
      if (res.statusCode === 200) return done(true, 'API respondendo');
      retry(`HTTP ${res.statusCode}`);
    });
    req.on('error', (e) => retry(e.message));
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
  };
  const retry = (why) => (Date.now() > deadline ? done(false, `A API não respondeu: ${why}`) : setTimeout(attempt, 2000));
  attempt();
}

try {
  if (cmd === 'configure') configure();
  else if (cmd === 'wait-health') waitHealth();
  else throw new Error('uso: setup.cjs configure|wait-health ...');
} catch (e) {
  const data = opt('data');
  for (const f of [opt('result'), data && path.join(data, 'setup-resultado.txt')]) {
    if (!f) continue;
    try {
      fs.writeFileSync(f, `ERRO\r\n${e.code ? `[${e.code}] ` : ''}${e.message}\r\n`);
    } catch {}
  }
  console.error(e.message);
  process.exit(1);
}
