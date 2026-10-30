import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createActiveUser, createTestEnv, login, VALID_CNPJS, type TestEnv } from './helpers';

let env: TestEnv;
let userToken: string;
let masterToken: string;

beforeAll(async () => {
  env = await createTestEnv();
  masterToken = await login(env);
  userToken = (await createActiveUser(env, masterToken)).token;
});
afterAll(async () => env.close());

describe('permissões (aplicadas no backend)', () => {
  const company = { corporateName: 'ABC Ltda', cnpj: VALID_CNPJS[0], folderName: 'ABC LTDA' };

  it.each([
    ['POST', '/companies', company],
    ['PATCH', '/companies/1', company],
    ['DELETE', '/companies/1', undefined],
    ['POST', '/companies/1/deactivate', {}],
    ['POST', '/companies/check-folders', {}],
    ['GET', '/users', undefined],
    ['POST', '/users/1/approve', {}],
    ['PATCH', '/users/1', { department: 'X' }],
    ['GET', '/settings', undefined],
    ['PATCH', '/settings', { emailNotificationsEnabled: false }],
    ['GET', '/audit', undefined],
    ['POST', '/runs/1/cancel', {}],
  ] as const)('usuário comum em %s %s → 403 Forbidden', async (method, url, payload) => {
    const res = await env.app.inject({ method, url, payload: payload as never, headers: { authorization: `Bearer ${userToken}` } });
    expect(res.statusCode).toBe(403);
  });

  it('usuário comum consulta dashboard, registros e empresas', async () => {
    const u = api(env, userToken);
    expect((await u.get('/dashboard')).statusCode).toBe(200);
    expect((await u.get('/records')).statusCode).toBe(200);
    expect((await u.get('/companies')).statusCode).toBe(200);
    expect((await u.get('/runs')).statusCode).toBe(200);
  });

  it('sem autenticação → 401', async () => {
    expect((await api(env).get('/records')).statusCode).toBe(401);
    expect((await api(env).get('/records/1/xml')).statusCode).toBe(401);
    expect((await api(env, 'token-invalido').get('/dashboard')).statusCode).toBe(401);
  });

  it('rotas do agente exigem AGENT_API_TOKEN', async () => {
    expect((await api(env).post('/agent/jobs/next')).statusCode).toBe(401);
    expect((await api(env, masterToken).post('/agent/jobs/next')).statusCode).toBe(401);
  });

  it('nome de pasta com path traversal é recusado', async () => {
    for (const folderName of ['..', '../outra', 'a\\b', 'C:\\Windows', 'x/y']) {
      const res = await api(env, masterToken).post('/companies', { ...company, folderName });
      expect(res.statusCode).toBe(400);
    }
  });

  it('CNPJ inválido é recusado', async () => {
    const res = await api(env, masterToken).post('/companies', { ...company, cnpj: '11111111111111' });
    expect(res.statusCode).toBe(400);
  });

  it('CORS restrito às origens configuradas', async () => {
    const ok = await env.app.inject({ method: 'GET', url: '/health', headers: { origin: 'http://localhost:5173' } });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const bad = await env.app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(bad.statusCode).toBe(403);
  });
});
