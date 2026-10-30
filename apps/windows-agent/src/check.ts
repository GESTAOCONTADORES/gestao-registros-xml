import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { stripAccents } from '@gestao/shared';
import { AgentApi, ApiError } from './api-client';
import { AGENT_VERSION, type AgentConfig } from './config';
import { isDirectory } from './fs-utils';
import { createLogger } from './logger';

/**
 * Diagnóstico usado pelo instalador e pelo atalho "Testar conexão".
 * Código de saída: 0 = tudo certo, 1 = falha na API, 2 = API ok mas pasta inacessível.
 */
export async function runCheck(config: AgentConfig, opts: { ascii?: boolean; outFile?: string } = {}): Promise<number> {
  const lines: string[] = [];
  const out = (msg: string) => {
    const text = opts.ascii ? stripAccents(msg).replace(/[—–]/g, '-').replace(/[✔✖⚠●]/g, '*') : msg;
    lines.push(text);
    try {
      console.log(text);
    } catch {
      // sem console (execução oculta): o resultado vai para o arquivo
    }
  };
  const finish = (code: number) => {
    if (opts.outFile) {
      try {
        writeFileSync(opts.outFile, lines.join('\r\n') + '\r\n');
      } catch {
        // ignora
      }
    }
    return code;
  };
  out(`Gestão XML Agent ${AGENT_VERSION}`);
  out(`API: ${config.apiUrl}`);
  const rootOk = isDirectory(config.rootPath);
  out(`Pasta monitorada: ${config.rootPath}`);
  out(rootOk ? '✔ Pasta acessível' : '⚠ Pasta NÃO acessível agora (verifique se o Google Drive está aberto e conectado)');

  const api = new AgentApi(config.apiUrl, config.token, createLogger(null, 1, false));
  try {
    await api.heartbeat({
      version: AGENT_VERSION,
      hostname: hostname(),
      rootPath: config.rootPath,
      reportsPath: join(config.rootPath, config.reportsFolderName),
      rootAccessible: rootOk,
    });
    out('✔ Conexão com a API: OK (o sistema já mostra "Agente XML ● Online")');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      out('✖ A API recusou o token do agente. Confira o AGENT_API_TOKEN informado.');
    } else {
      out(`✖ Não foi possível conectar à API: ${(e as Error).message}`);
      out('  Confira o endereço da API e a conexão com a internet.');
    }
    return finish(1);
  }
  return finish(rootOk ? 0 : 2);
}
