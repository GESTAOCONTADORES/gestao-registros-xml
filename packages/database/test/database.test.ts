import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, migrate, restorePglite, seed, verifyPassword } from '../src';

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

  it('backup do banco embutido pode ser restaurado com todos os dados', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dp-backup-'));
    try {
      const db = await createDb(`pglite://${join(dir, 'origem')}`);
      await migrate(db);
      await seed(db, { masterPassword: 'DP102030' });
      await db.query(`INSERT INTO companies (corporate_name, cnpj, folder_name) VALUES ('Backup Ltda', '11222333000181', 'B')`);
      const backup = await db.backup!();
      await db.close();
      expect(backup.subarray(0, 2).toString('hex')).toBe('1f8b'); // gzip

      await restorePglite(join(dir, 'restaurado'), backup);
      const restored = await createDb(`pglite://${join(dir, 'restaurado')}`);
      const c = await restored.query<{ corporate_name: string }>('SELECT corporate_name FROM companies');
      expect(c.rows[0]!.corporate_name).toBe('Backup Ltda');
      expect((await restored.query('SELECT 1 FROM users')).rowCount).toBe(1);
      expect(await migrate(restored)).toEqual([]);
      await restored.close();

      // arquivo inválido ou de outro banco: erro, e nada é criado
      await expect(restorePglite(join(dir, 'x1'), Buffer.from('lixo'.repeat(400)))).rejects.toThrow(/não é um backup válido/);
      const other = await createDb(`pglite://${join(dir, 'outro')}`);
      await other.query('CREATE TABLE qualquer (id int)');
      const otherBackup = await other.backup!();
      await other.close();
      await expect(restorePglite(join(dir, 'x2'), otherBackup)).rejects.toThrow(/não contém um banco do sistema/);
      const { existsSync } = await import('node:fs');
      expect(existsSync(join(dir, 'x2'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
