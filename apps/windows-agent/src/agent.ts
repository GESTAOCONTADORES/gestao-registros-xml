import { hostname } from 'node:os';
import { join } from 'node:path';
import { AgentApi } from './api-client';
import { FileCache } from './cache';
import { AGENT_VERSION, type AgentConfig } from './config';
import { isDirectory } from './fs-utils';
import { executeJob } from './jobs';
import type { Logger } from './logger';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Agent {
  private api: AgentApi;
  private cache: FileCache;
  private stopping = false;
  private currentJobId: number | null = null;
  private lastError: string | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private loopDone: Promise<void> | null = null;

  constructor(
    private config: AgentConfig,
    private log: Logger,
  ) {
    this.api = new AgentApi(config.apiUrl, config.token, log);
    this.cache = new FileCache(join(config.dataDir, 'cache.json'));
  }

  rootAccessible() {
    return isDirectory(this.config.rootPath);
  }

  private async heartbeat() {
    try {
      const accessible = this.rootAccessible();
      if (!accessible) this.lastError = `Pasta raiz inacessível: ${this.config.rootPath}`;
      else if (this.lastError?.startsWith('Pasta raiz')) this.lastError = null;
      await this.api.heartbeat({
        version: AGENT_VERSION,
        hostname: hostname(),
        rootPath: this.config.rootPath,
        reportsPath: join(this.config.rootPath, this.config.reportsFolderName),
        rootAccessible: accessible,
        lastError: this.lastError,
        currentJobId: this.currentJobId,
      });
    } catch (e) {
      this.log.warn(`Heartbeat falhou: ${(e as Error).message}`);
    }
  }

  start() {
    this.log.info(`Gestão XML Agent ${AGENT_VERSION} iniciado — API ${this.config.apiUrl}`);
    this.log.info(`Pasta monitorada: ${this.config.rootPath} (${this.rootAccessible() ? 'acessível' : 'INACESSÍVEL'})`);
    void this.heartbeat();
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), this.config.heartbeatIntervalMs);
    this.loopDone = this.loop();
  }

  private async loop() {
    while (!this.stopping) {
      try {
        const job = await this.api.nextJob();
        if (job) {
          this.currentJobId = job.id;
          void this.heartbeat();
          this.log.info(`Job #${job.id} recebido (${job.type})`);
          await executeJob({ api: this.api, config: this.config, log: this.log, cache: this.cache, shuttingDown: () => this.stopping }, job);
          this.currentJobId = null;
          continue; // pode haver outro job na fila
        }
      } catch (e) {
        this.lastError = (e as Error).message;
        this.log.warn(`Não foi possível consultar a fila de trabalhos: ${(e as Error).message}`);
      }
      await sleep(this.config.pollIntervalMs);
    }
  }

  /** Encerramento seguro: termina o arquivo atual e informa a API. */
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    this.log.info('Encerrando o agente...');
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    await Promise.race([this.loopDone, sleep(60_000)]);
    this.cache.save();
    this.log.info('Agente encerrado.');
  }
}
