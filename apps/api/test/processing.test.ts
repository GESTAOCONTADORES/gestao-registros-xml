import { existsSync, readdirSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { esocialS1200, esocialS2200 } from '../../../test-fixtures/xml';
import { api, createActiveUser, createTestAgent, createTestEnv, login, VALID_CNPJS, writeXml, type TestEnv } from './helpers';

let env: TestEnv;
let master: ReturnType<typeof api>;
let user: ReturnType<typeof api>;
let agent: ReturnType<typeof createTestAgent>;
const ids: Record<string, number> = {};

beforeAll(async () => {
  env = await createTestEnv();
  const masterToken = await login(env);
  master = api(env, masterToken);
  user = api(env, (await createActiveUser(env, masterToken)).token);
  agent = createTestAgent(env);

  const mk = async (name: string, cnpj: string, folderName: string) => {
    const res = await master.post('/companies', { corporateName: name, cnpj, folderName });
    expect(res.statusCode).toBe(201);
    ids[name] = res.json().id;
  };
  await mk('ABC Ltda', VALID_CNPJS[0]!, 'ABC LTDA');
  await mk('XYZ Comércio', VALID_CNPJS[1]!, 'XYZ COMERCIO');
  await mk('Inativa SA', VALID_CNPJS[2]!, 'INATIVA SA');
  await mk('Sem Pasta ME', VALID_CNPJS[3]!, 'SEM PASTA');
  await master.post(`/companies/${ids['Inativa SA']}/deactivate`);

  // pasta da ABC: o mesmo XML duas vezes (cópia em subpasta), um XML inválido e um de outra competência
  writeXml(env, 'ABC LTDA', 'S1200_bruno.xml', esocialS1200({ cpf: '52998224725' }));
  writeXml(env, 'ABC LTDA', 'copias/S1200_bruno (1).xml', esocialS1200({ cpf: '52998224725' }));
  writeXml(env, 'ABC LTDA', 'S2200_maria.xml', esocialS2200());
  writeXml(env, 'ABC LTDA', 'corrompido.xml', '<eSocial><evtRemun><perApur>2026-10</perApur>');
  // sem competência legível, vale a data do arquivo: fixada em outubro/2026
  const oct = new Date('2026-10-15T12:00:00Z');
  utimesSync(join(env.root, 'ABC LTDA', 'corrompido.xml'), oct, oct);
  writeXml(env, 'ABC LTDA', 'S1200_setembro.xml', esocialS1200({ perApur: '2026-09', id: 'ID9', recibo: '9.9' }));
  writeXml(env, 'ABC LTDA', 'leia-me.txt', 'não é xml');
  for (let i = 0; i < 4; i++) {
    writeXml(env, 'XYZ COMERCIO', `2026/10/S1200_${i}.xml`, esocialS1200({ cpf: `1114447773${i}`, id: `IDX${i}`, recibo: `x.${i}` }));
  }
  writeXml(env, 'INATIVA SA', 'S1200.xml', esocialS1200({ id: 'IDINATIVA', recibo: 'inativa' }));
});
afterAll(async () => env.close());

async function waitRun(runId: number) {
  for (let i = 0; i < 100; i++) {
    const r = (await master.get(`/runs/${runId}`)).json();
    if (!['QUEUED', 'RUNNING'].includes(r.run.status)) return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('execução não terminou');
}

describe('agente offline', () => {
  it('iniciar pesquisa sem agente retorna mensagem compreensível', async () => {
    const res = await user.post('/runs', { scope: 'ALL', year: 2026, month: 10 });
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toBe('O servidor responsável pelo acesso à pasta compartilhada está offline.');
    const status = (await user.get('/agent-status')).json();
    expect(status.online).toBe(false);
  });
});

describe('pesquisa em lote com o agente real', () => {
  let runId: number;

  it('verifica as pastas das empresas cadastradas (sem criar nenhuma)', async () => {
    await agent.heartbeat();
    await agent.drain();
    const companies = (await master.get('/companies')).json() as { corporateName: string; folderStatus: string }[];
    const by = Object.fromEntries(companies.map((c) => [c.corporateName, c.folderStatus]));
    expect(by['ABC Ltda']).toBe('FOUND');
    expect(by['Sem Pasta ME']).toBe('NOT_FOUND');
    expect(existsSync(join(env.root, 'SEM PASTA'))).toBe(false);
  });

  it('resumo prévio: empresas inativas não entram em lote automático', async () => {
    const res = await user.post('/runs/preview', { scope: 'ALL', year: 2026, month: 10 });
    const names = res.json().companies.map((c: { name: string }) => c.name);
    expect(names).not.toContain('Inativa SA');
    expect(res.json().ignoredInactive).toBe(1);
  });

  it('usuário comum inicia a pesquisa; uma segunda pesquisa simultânea é recusada', async () => {
    const res = await user.post('/runs', { scope: 'ALL', year: 2026, month: 10 });
    expect(res.statusCode).toBe(201);
    runId = res.json().run.id;
    expect(res.json().run.status).toBe('QUEUED');
    expect(res.json().companies.map((c: { companyName: string }) => c.companyName)).not.toContain('Inativa SA');
    const again = await user.post('/runs', { scope: 'ALL', year: 2026, month: 10 });
    expect(again.statusCode).toBe(409);
    const active = (await user.get('/runs/active')).json();
    expect(active.run.id).toBe(runId);
  });

  it('processa: duplicado dentro do lote, XML inválido não interrompe, competência filtrada', async () => {
    await agent.drain();
    const { run, companies } = await waitRun(runId);
    // ABC: 2 cópias idênticas (1 importado / 1 ignorado) + S-2200 + 1 inválido; o de setembro fica fora
    // XYZ: 4 novos
    expect(run.newFiles).toBe(6);
    expect(run.duplicates).toBe(1);
    expect(run.errors).toBe(1);
    expect(run.status).toBe('COMPLETED_WITH_ERRORS');
    expect(run.progress).toBe(100);
    expect(run.totalFiles).toBe(9); // XML localizados nas pastas ativas (o .txt é ignorado)
    expect(run.filesChecked).toBe(9);
    const abc = companies.find((c: { companyName: string }) => c.companyName === 'ABC Ltda');
    expect(abc).toMatchObject({ status: 'DONE', newFiles: 2, duplicates: 1, errors: 1 });
    const semPasta = companies.find((c: { companyName: string }) => c.companyName === 'Sem Pasta ME');
    expect(semPasta.status).toBe('FOLDER_NOT_FOUND');
  });

  it('o arquivo com erro pode ser consultado', async () => {
    const files = (await master.get(`/runs/${runId}/files?status=ERROR`)).json();
    expect(files.items).toHaveLength(1);
    expect(files.items[0].filename).toBe('corrompido.xml');
    expect(files.items[0].errorMessage).toMatch(/XML inválido/);
    const content = await master.get(`/runs/${runId}/files/${files.items[0].id}/content`);
    expect(content.statusCode).toBe(200);
    expect(content.body).toContain('<eSocial>');
  });

  it('segunda execução: nada é importado novamente (SHA-256)', async () => {
    const res = await master.post('/runs', { scope: 'SELECTED', companyIds: [ids['ABC Ltda'], ids['XYZ Comércio']], year: 2026, month: 10 });
    await agent.heartbeat();
    await agent.drain();
    const { run } = await waitRun(res.json().run.id);
    expect(run.newFiles).toBe(0);
    expect(run.duplicates).toBe(7);
    expect(run.errors).toBe(1);
    const count = await env.db.query<{ n: number }>('SELECT count(*)::int AS n FROM imported_files');
    expect(count.rows[0]!.n).toBe(6);
  });

  it('mesmo XML em nova execução com verificação completa: 1 importado / 1 ignorado continua valendo', async () => {
    const res = await master.post('/runs', { scope: 'SINGLE', companyIds: [ids['ABC Ltda']], year: 2026, month: 9, fullRescan: true });
    await agent.drain();
    const { run } = await waitRun(res.json().run.id);
    expect(run.newFiles).toBe(1); // setembro, ainda não importado
    expect(run.duplicates).toBe(0);
  });

  it('pesquisa individual de empresa inativa só ocorre por seleção explícita', async () => {
    const res = await master.post('/runs', { scope: 'SINGLE', companyIds: [ids['Inativa SA']], year: 2026, month: 10 });
    expect(res.statusCode).toBe(201);
    await agent.drain();
    const { run } = await waitRun(res.json().run.id);
    expect(run.newFiles).toBe(1);
  });

  it('notificações e auditoria registram a execução', async () => {
    const notifs = (await user.get('/notifications')).json();
    expect(notifs.items.some((n: { title: string }) => n.title.startsWith(`Pesquisa #${runId}`))).toBe(true);
    expect(notifs.unread).toBeGreaterThan(0);
    const audit = (await master.get('/audit?action=RUN_FINISHED')).json();
    expect(audit.total).toBeGreaterThanOrEqual(1);
  });
});

describe('consulta, downloads e dashboard', () => {
  it('pesquisa por CPF formatado, nome do trabalhador, competência e empresa', async () => {
    expect((await user.get('/records?search=111.444.777-30')).json().total).toBe(1);
    expect((await user.get('/records?search=52998224725')).json().total).toBe(3);
    expect((await user.get('/records?search=maria')).json().total).toBe(1);
    expect((await user.get(`/records?search=${encodeURIComponent('10/2026')}`)).json().total).toBeGreaterThanOrEqual(6);
    expect((await user.get('/records?search=XYZ')).json().total).toBe(4);
    const page = (await user.get('/records?page=1&pageSize=5')).json();
    expect(page.items).toHaveLength(5);
    expect(page.total).toBe(8);
  });

  it('XML baixado é idêntico ao original; HTML e PDF são gerados', async () => {
    const list = (await user.get('/records?search=maria')).json();
    const id = list.items[0].id;
    const xml = await user.get(`/records/${id}/xml`);
    expect(xml.rawPayload.equals(readFileSync(join(env.root, 'ABC LTDA', 'S2200_maria.xml')))).toBe(true);
    expect(xml.headers['content-disposition']).toContain('S2200_maria.xml');
    const html = await user.get(`/records/${id}/html`);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.body).toContain('Maria da Silva');
    expect(html.body).toContain('Admissão de Trabalhador');
    expect(html.body).not.toContain('<script');
    const pdf = await user.get(`/records/${id}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const downloads = (await master.get('/audit?action=DOWNLOAD')).json();
    expect(downloads.total).toBe(4); // inclui o download do arquivo com erro
  });

  it('download em lote gera ZIP com o nome padrão', async () => {
    const res = await user.post('/records/bulk-download', { companyIds: [ids['XYZ Comércio']], year: 2026, month: 10, format: 'xml' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('GESTAO_XML_XYZ_COMERCIO_2026-10.zip');
    expect(res.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  it('dashboard e gráficos usam os dados do banco', async () => {
    const d = (await user.get('/dashboard?year=2026&month=10')).json();
    expect(d.monitoredCompanies).toBe(3);
    expect(d.newFiles).toBe(7);
    expect(d.errors).toBe(1);
    expect(d.byCompany.find((c: { companyName: string }) => c.companyName === 'XYZ Comércio').imported).toBe(4);
    expect(d.byMonth[9].imported).toBe(7);
    expect(d.byMonth[8].imported).toBe(1);
    expect(d.years).toContain(2026);
    expect(d.lastRun).not.toBeNull();
  });

  it('excluir empresa da base do robô não apaga arquivos nem registros', async () => {
    const res = await master.del(`/companies/${ids['Inativa SA']}`);
    expect(res.statusCode).toBe(200);
    expect(existsSync(join(env.root, 'INATIVA SA', 'S1200.xml'))).toBe(true);
    const list = (await master.get('/companies')).json().map((c: { corporateName: string }) => c.corporateName);
    expect(list).not.toContain('Inativa SA');
    expect((await master.get('/records?search=inativa')).json().total).toBe(1);
  });
});

describe('cancelamento e relatório', () => {
  it('Master cancela; o que já foi processado é mantido', async () => {
    for (let i = 0; i < 6; i++) writeXml(env, 'ABC LTDA', `nov/S1200_nov_${i}.xml`, esocialS1200({ perApur: '2026-11', id: `IDN${i}`, recibo: `n.${i}` }));
    const res = await master.post('/runs', { scope: 'SINGLE', companyIds: [ids['ABC Ltda']], year: 2026, month: 11 });
    const runId = res.json().run.id;
    // o agente processa o primeiro lote (3 arquivos) e o Master cancela em seguida
    let cancelled = false;
    const origSend = agent.api.sendFiles.bind(agent.api);
    agent.api.sendFiles = async (id, batch) => {
      const r = await origSend(id, batch);
      if (!cancelled) {
        cancelled = true;
        await master.post(`/runs/${runId}/cancel`);
        return { ...r, cancelRequested: true };
      }
      return r;
    };
    await agent.drain();
    agent.api.sendFiles = origSend;
    const { run } = await waitRun(runId);
    expect(run.status).toBe('CANCELLED');
    expect(run.newFiles).toBe(3);
    const count = await env.db.query<{ n: number }>('SELECT count(*)::int AS n FROM imported_files WHERE month = 11');
    expect(count.rows[0]!.n).toBe(3);
  });

  it('relatório PDF é criado, registrado e salvo em RELATORIOS ROBO', async () => {
    const res = await user.post('/reports', { year: 2026, month: 10 });
    expect(res.statusCode).toBe(201);
    const report = res.json();
    expect(report.filename).toMatch(/^Relatorio_XML_DP_2026-10_\d{4}-\d{2}-\d{2}_\d{6}\.pdf$/);
    // 2 execuções de outubro viram o arquivo corrompido; 7 novos (6 + empresa inativa por seleção explícita)
    expect(report.summary).toMatchObject({ newFiles: 7, errors: 2, duplicates: 8 });
    expect(report.driveStatus).toBe('PENDING');

    const pdf = await user.get(`/reports/${report.id}/pdf`);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.rawPayload.length).toBeGreaterThan(3000);

    await agent.drain();
    const list = (await user.get('/reports')).json();
    const saved = list.items.find((r: { id: number }) => r.id === report.id);
    expect(saved.driveStatus).toBe('SAVED');
    const dir = join(env.root, 'RELATORIOS ROBO');
    const year = readdirSync(dir)[0]!;
    const month = readdirSync(join(dir, year))[0]!;
    expect(month).toMatch(/^\d{2} - [A-Z]+$/);
    expect(readdirSync(join(dir, year, month))).toContain(report.filename);
    expect(saved.drivePath).toContain(report.filename);
    const audit = (await master.get('/audit?action=REPORT_GENERATED')).json();
    expect(audit.total).toBe(1);
  });
});
