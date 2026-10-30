import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestEnv, login, MASTER, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

describe('login e aprovação de acessos', () => {
  it('Master inicial entra com o nome e a senha do .env (senha só como hash)', async () => {
    const res = await api(env).post('/auth/login', MASTER);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.role).toBe('MASTER');
    expect(`${body.user.firstName} ${body.user.lastName} / ${body.user.department}`).toBe('Departamento pessoal / Departamento Pessoal');
    expect(res.cookies.find((c) => c.name === 'dp_rt')?.httpOnly).toBe(true);
    const row = await env.db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE username = 'departamento.pessoal'");
    expect(row.rows[0]!.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.rows[0]!.password_hash).not.toContain('DP102030');
  });

  it('solicitação de acesso gera identificador, notificação para o Master e e-mail para o DP', async () => {
    const res = await api(env).post('/auth/request-access', {
      firstName: 'Bruno',
      lastName: 'Sales',
      department: 'Departamento Pessoal',
      password: 'abc123',
      confirmPassword: 'abc123',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ username: 'bruno.sales', status: 'PENDING' });
    expect(env.mails.at(-1)?.to).toBe('dp@example.test');
    const token = await login(env);
    const notifs = await api(env, token).get('/notifications');
    expect(notifs.json().items.some((n: { type: string }) => n.type === 'ACCESS_REQUEST')).toBe(true);
  });

  it('valida senha mínima de 6 caracteres e confirmação', async () => {
    const short = await api(env).post('/auth/request-access', {
      firstName: 'A',
      lastName: 'B',
      department: 'DP',
      password: '123',
      confirmPassword: '123',
    });
    expect(short.statusCode).toBe(400);
    const mismatch = await api(env).post('/auth/request-access', {
      firstName: 'A',
      lastName: 'B',
      department: 'DP',
      password: '123456',
      confirmPassword: '654321',
    });
    expect(mismatch.statusCode).toBe(400);
  });

  it('login pendente NÃO permite acesso', async () => {
    const res = await api(env).post('/auth/login', { username: 'bruno.sales', password: 'abc123' });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/aguardando aprovação/i);
  });

  it('login rejeitado NÃO permite acesso', async () => {
    await api(env).post('/auth/request-access', {
      firstName: 'Carla',
      lastName: 'Lima',
      department: 'Fiscal',
      password: 'abc123',
      confirmPassword: 'abc123',
    });
    const token = await login(env);
    const list = await api(env, token).get('/users?status=PENDING');
    const carla = list.json().items.find((u: { username: string }) => u.username === 'carla.lima');
    const rej = await api(env, token).post(`/users/${carla.id}/reject`);
    expect(rej.json().status).toBe('REJECTED');
    const res = await api(env).post('/auth/login', { username: 'carla.lima', password: 'abc123' });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/rejeitada/i);
  });

  it('após aprovação o usuário entra (o nome digitado é normalizado)', async () => {
    const token = await login(env);
    const list = await api(env, token).get('/users?status=PENDING');
    const bruno = list.json().items.find((u: { username: string }) => u.username === 'bruno.sales');
    const ok = await api(env, token).post(`/users/${bruno.id}/approve`);
    expect(ok.json()).toMatchObject({ status: 'ACTIVE', approvedByName: 'Departamento pessoal' });
    const res = await api(env).post('/auth/login', { username: 'Bruno Sales', password: 'abc123' });
    expect(res.statusCode).toBe(200);
  });

  it('usuário bloqueado perde o acesso imediatamente', async () => {
    const master = await login(env);
    const userToken = await login(env, 'bruno.sales', 'abc123');
    expect((await api(env, userToken).get('/auth/me')).statusCode).toBe(200);
    const list = await api(env, master).get('/users');
    const bruno = list.json().items.find((u: { username: string }) => u.username === 'bruno.sales');
    await api(env, master).post(`/users/${bruno.id}/block`);
    expect((await api(env, userToken).get('/auth/me')).statusCode).toBe(401);
    await api(env, master).post(`/users/${bruno.id}/reactivate`);
  });

  it('proteção contra força bruta: bloqueio temporário após tentativas inválidas', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await api(env).post('/auth/login', { username: 'bruno.sales', password: 'errada' });
      expect(r.statusCode).toBe(401);
    }
    const locked = await api(env).post('/auth/login', { username: 'bruno.sales', password: 'abc123' });
    expect(locked.statusCode).toBe(429);
    await env.db.query("UPDATE users SET locked_until = NULL WHERE username = 'bruno.sales'");
  });

  it('refresh token é rotacionado e a reutilização revoga a sessão', async () => {
    const res = await api(env).post('/auth/login', MASTER);
    const cookie = res.cookies.find((c) => c.name === 'dp_rt')!.value;
    const r1 = await env.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { dp_rt: cookie } });
    expect(r1.statusCode).toBe(200);
    const newCookie = r1.cookies.find((c) => c.name === 'dp_rt')!.value;
    expect(newCookie).not.toBe(cookie);
    const reuse = await env.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { dp_rt: cookie } });
    expect(reuse.statusCode).toBe(401);
    const afterReuse = await env.app.inject({ method: 'POST', url: '/auth/refresh', cookies: { dp_rt: newCookie } });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('Master pode alterar a própria senha', async () => {
    const token = await login(env);
    const res = await api(env, token).post('/auth/change-password', {
      currentPassword: MASTER.password,
      newPassword: 'NovaSenha1',
      confirmPassword: 'NovaSenha1',
    });
    expect(res.statusCode).toBe(200);
    expect((await api(env).post('/auth/login', { username: MASTER.username, password: 'NovaSenha1' })).statusCode).toBe(200);
    await api(env, token).post('/auth/change-password', {
      currentPassword: 'NovaSenha1',
      newPassword: MASTER.password,
      confirmPassword: MASTER.password,
    });
  });

  it('Configurações: desativar notificações por e-mail interrompe os e-mails', async () => {
    const token = await login(env);
    const before = env.mails.length;
    const off = await api(env, token).patch('/settings', { emailNotificationsEnabled: false });
    expect(off.json().emailNotificationsEnabled).toBe(false);
    await api(env).post('/auth/request-access', {
      firstName: 'Davi',
      lastName: 'Rocha',
      department: 'DP',
      password: 'abc123',
      confirmPassword: 'abc123',
    });
    expect(env.mails.length).toBe(before);
    await api(env, token).patch('/settings', { emailNotificationsEnabled: true });
  });

  it('auditoria registra login, cadastro, aprovação e rejeição', async () => {
    const token = await login(env);
    const res = await api(env, token).get('/audit?pageSize=200');
    const actions = new Set(res.json().items.map((a: { action: string }) => a.action));
    for (const a of ['LOGIN', 'USER_REQUESTED', 'USER_APPROVED', 'USER_REJECTED', 'LOGIN_FAILED']) expect(actions).toContain(a);
  });
});
