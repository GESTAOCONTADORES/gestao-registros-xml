import { normalizeUsername } from '@gestao/shared';
import type { Db } from './client';
import { hashPassword } from './password';

export interface SeedOptions {
  masterName?: string;
  masterDepartment?: string;
  masterPassword?: string;
}

/**
 * Cria o usuário Master inicial, somente se ainda não existir.
 * A senha vem de MASTER_INITIAL_PASSWORD e é gravada apenas como hash Argon2id.
 * Nenhuma empresa fictícia é criada.
 */
export async function seed(db: Db, options: SeedOptions = {}, log: (msg: string) => void = () => undefined) {
  const name = (options.masterName ?? process.env.MASTER_NAME ?? 'Departamento pessoal').trim();
  const department = (options.masterDepartment ?? process.env.MASTER_DEPARTMENT ?? 'Departamento Pessoal').trim();
  const password = options.masterPassword ?? process.env.MASTER_INITIAL_PASSWORD;
  const username = normalizeUsername(name);

  const existing = await db.query('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
  if (existing.rowCount > 0) {
    log(`Master "${username}" já existe — nada a fazer.`);
    return { created: false, username };
  }
  if (!password || password.length < 6) {
    throw new Error('Defina MASTER_INITIAL_PASSWORD (mínimo 6 caracteres) para criar o Master inicial.');
  }

  const [firstName, ...rest] = name.split(/\s+/);
  await db.query(
    `INSERT INTO users (first_name, last_name, username, department, password_hash, role, status, approved_at, password_changed_at)
     VALUES ($1, $2, $3, $4, $5, 'MASTER', 'ACTIVE', now(), now())`,
    [firstName, rest.join(' '), username, department, await hashPassword(password)],
  );
  log(`Master "${username}" criado.`);
  return { created: true, username };
}
