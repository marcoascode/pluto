import pg from 'pg';
import { config } from './config.js';

// NUMERIC e BIGINT chegam como string no pg; aqui viram number (os valores cabem em double).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// DATE fica como 'YYYY-MM-DD' (sem fuso), igual ao contrato da API.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: config.db.max,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'pluto-server',
});
pool.on('error', (e) => console.error('[pg] erro em conexão ociosa', e.message));

export type Db = Pick<pg.PoolClient, 'query'>;

/** Consulta com placeholders $1, $2… (nunca concatenar valores no SQL). */
export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query<T>(text, params);
  return r.rows;
}
export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  return (await q<T>(text, params, db))[0] ?? null;
}

/** Transação: BEGIN … COMMIT, ROLLBACK em erro. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
