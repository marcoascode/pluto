/** Aplica migrations/*.sql em ordem, uma vez cada (tabela schema_migrations). Roda no boot e via `npm run migrate`. */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727001)'); // evita duas instâncias migrando juntas
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await c.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(DIR, f), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
        await c.query('COMMIT');
        console.log(`[migrate] aplicada ${f}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`[migrate] falhou em ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    c.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
