import { join } from 'node:path';
import { Agent } from './agent';
import { appDir, loadConfig, loadEnvFile } from './config';
import { createLogger } from './logger';

// .env ao lado do executável (produção) ou na pasta atual (desenvolvimento)
loadEnvFile(join(appDir(), '.env'));
loadEnvFile(join(appDir(), '..', '.env'));
loadEnvFile(join(process.cwd(), '.env'));

let config;
try {
  config = loadConfig();
} catch (e) {
  console.error(`Configuração inválida: ${(e as Error).message}`);
  process.exit(1);
}

const log = createLogger(join(config.dataDir, 'logs'), config.logRetentionDays);
const agent = new Agent(config, log);
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
