import { describe, expect, it } from 'vitest';
import { createDb, migrate, seed, verifyPassword } from '../src';

describe('banco de dados', () => {
  it('migrations são idempotentes e o seed não duplica o Master', async () => {
    const db = await createDb('pglite://memory');
    expect(await migrate(db)).toEqual(['001_init.sql']);
    expect(await migrate(db)).toEqual([]);
    expect((await seed(db, { masterPassword: 'DP102030' })).created).toBe(true);
    expect((await seed(db, { masterPassword: 'DP102030' })).created).toBe(false);
    const { rows, rowCount } = await db.query<{ password_hash: string; role: string }>('SELECT password_hash, role FROM users');
    expect(rowCount).toBe(1);
    expect(rows[0]!.role).toBe('MASTER');
    expect(await verifyPassword(rows[0]!.password_hash, 'DP102030')).toBe(true);
    await db.close();
  });

  it('file_hash é único: o mesmo XML nunca é gravado duas vezes', async () => {
    const db = await createDb('pglite://memory');
    await migrate(db);
    await db.query(`INSERT INTO companies (corporate_name, cnpj, folder_name) VALUES ('A', '11222333000181', 'A')`);
    const insert = () =>
      db.query(
        `INSERT INTO imported_files (company_id, filename, relative_path, file_hash, file_size)
         VALUES (1, 'a.xml', 'a.xml', $1, 10) ON CONFLICT (file_hash) DO NOTHING RETURNING id`,
        ['a'.repeat(64)],
      );
    expect((await insert()).rowCount).toBe(1);
    expect((await insert()).rowCount).toBe(0);
    await expect(
      db.query(`INSERT INTO imported_files (company_id, filename, relative_path, file_hash, file_size) VALUES (1, 'b', 'b', $1, 1)`, [
        'a'.repeat(64),
      ]),
    ).rejects.toThrow(/imported_files_file_hash_uq/);
    await db.close();
  });
});
