import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Agent } from './agent';
import { runCheck } from './check';
import { appDir, loadConfig, loadEnvFile, type AgentConfig } from './config';
import { createLogger } from './logger';

// .env ao lado do executável (produção) ou na pasta atual (desenvolvimento)
loadEnvFile(join(appDir(), '.env'));
loadEnvFile(join(appDir(), '..', '.env'));
loadEnvFile(join(process.cwd(), '.env'));

let config: AgentConfig;
try {
  config = loadConfig();
} catch (e) {
  console.error(`Configuração inválida: ${(e as Error).message}`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  // diagnóstico (instalador / atalho "Testar conexão")
  const outArg = process.argv.find((a) => a.startsWith('--out='));
  void runCheck(config, { ascii: process.argv.includes('--ascii'), outFile: outArg?.slice('--out='.length) }).then((code) =>
    process.exit(code),
  );
} else {
  start(config);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function start(cfg: AgentConfig) {
  const log = createLogger(join(cfg.dataDir, 'logs'), cfg.logRetentionDays);

  // apenas uma instância por computador/pasta de dados
  mkdirSync(cfg.dataDir, { recursive: true });
  const lockFile = join(cfg.dataDir, 'agent.lock');
  try {
    const pid = Number(readFileSync(lockFile, 'utf8'));
    if (pid && pid !== process.pid && isRunning(pid)) {
      log.warn(`Outra instância do agente já está em execução (PID ${pid}). Encerrando esta.`);
      process.exit(0);
    }
  } catch {
    // sem trava anterior
  }
  writeFileSync(lockFile, String(process.pid));
  process.on('exit', () => {
    try {
      if (readFileSync(lockFile, 'utf8') === String(process.pid)) unlinkSync(lockFile);
    } catch {
      // ignora
    }
  });

  const agent = new Agent(cfg, log);
  agent.start();

  const shutdown = () => {
    void agent.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // node-windows envia "shutdown" via mensagem ao encerrar o serviço
  process.on('message', (msg) => {
    if (msg === 'shutdown') shutdown();
  });
  process.on('uncaughtException', (err) => log.error(`Erro inesperado: ${err.stack ?? err.message}`));
  process.on('unhandledRejection', (err) => log.error(`Promessa rejeitada: ${String(err)}`));
}
