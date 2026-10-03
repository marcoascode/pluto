/**
 * Agendador simples dentro do processo: a cada minuto pega os jobs vencidos (sync_settings.next_run_at <= now()).
 * FOR UPDATE SKIP LOCKED evita rodar o mesmo job duas vezes se houver mais de uma instância.
 * Jobs com falha tentam de novo com backoff (5, 10, 20… min, até a frequência do job).
 */
import { pool } from '../db.js';
import { runJob } from './sync/index.js';

let timer: NodeJS.Timeout | null = null;
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const c = await pool.connect();
    let due: string[] = [];
    try {
      await c.query('BEGIN');
      const r = await c.query<{ id: string }>(`SELECT id FROM sync_settings WHERE enabled AND (next_run_at IS NULL OR next_run_at <= now()) ORDER BY next_run_at NULLS FIRST LIMIT 5 FOR UPDATE SKIP LOCKED`);
      due = r.rows.map((x) => x.id);
      // reserva: empurra o próximo horário para não pegar de novo enquanto roda
      if (due.length) await c.query(`UPDATE sync_settings SET next_run_at = now() + interval '10 minutes' WHERE id = ANY($1)`, [due]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    for (const id of due) {
      const res = await runJob(id);
      if (res.status === 'failed') {
        const fails = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM (SELECT status FROM sync_jobs WHERE setting_id = $1 ORDER BY id DESC LIMIT 6) t WHERE status = 'failed'`, [id]);
        const backoff = Math.min(5 * 2 ** Math.max(0, fails.rows[0].n - 1), 1440);
        await pool.query(`UPDATE sync_settings SET next_run_at = now() + make_interval(mins => LEAST($2, every_minutes)) WHERE id = $1`, [id, backoff]);
        console.warn(`[sync] ${id} falhou: ${res.message} · nova tentativa em ${backoff} min`);
      } else if (res.message) console.log(`[sync] ${id}: ${res.status} · ${res.message}`);
    }
  } catch (e) {
    console.error('[scheduler]', (e as Error).message);
  } finally {
    busy = false;
  }
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
  console.log('[scheduler] ligado (verifica a cada 1 min)');
}
export function stopScheduler() { if (timer) clearInterval(timer); timer = null; }
