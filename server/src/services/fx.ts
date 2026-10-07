/**
 * Câmbio USD → BRL/EUR.
 * Fonte principal: Frankfurter (https://frankfurter.dev, sem chave, taxas de referência de bancos centrais).
 *   GET {FX_API_URL}?base=USD&quotes=BRL,EUR                       → hoje
 *   GET {FX_API_URL}?base=USD&quotes=BRL,EUR&from=YYYY-MM-DD&to=…  → série
 *   Resposta: [{ date, base, quote, rate }, …]
 * Reserva: open.er-api.com (só a cotação do dia).
 * Guarda UMA linha por dia e moeda; dias sem publicação repetem a última taxa (a conversão é por dia).
 */
import { config } from '../config.js';
import { one, q, tx } from '../db.js';
import { addDays, daysBetween, today } from '../lib/dates.js';

type Quote = 'BRL' | 'EUR';
const QUOTES: Quote[] = ['BRL', 'EUR'];
interface Rate { date: string; currency: Quote; rate: number }

async function getJson(url: string, timeoutMs = 15_000): Promise<unknown> {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'pluto-server' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${new URL(url).host}`);
  return r.json();
}

/** Aceita o formato v2 (array) e o antigo v1 ({ rates: { BRL } } ou { rates: { 'YYYY-MM-DD': { BRL } } }). */
function parseFrankfurter(data: unknown, fallbackDate: string): Rate[] {
  const out: Rate[] = [];
  const push = (date: string, cur: string, rate: unknown) => { const c = cur.toUpperCase(); if ((QUOTES as string[]).includes(c) && Number(rate) > 0) out.push({ date, currency: c as Quote, rate: Number(rate) }); };
  if (Array.isArray(data)) for (const x of data as { date: string; quote: string; rate: number }[]) push(x.date, x.quote, x.rate);
  else if (data && typeof data === 'object' && 'rates' in data) {
    const d = data as { date?: string; rates: Record<string, unknown> };
    for (const [k, v] of Object.entries(d.rates)) {
      if (v && typeof v === 'object') for (const [c, r] of Object.entries(v as Record<string, unknown>)) push(k, c, r);
      else push(d.date ?? fallbackDate, k, v);
    }
  }
  return out;
}

async function fetchFrankfurter(from?: string, to?: string): Promise<Rate[]> {
  const u = new URL(config.fx.url);
  u.searchParams.set('base', 'USD');
  u.searchParams.set('quotes', QUOTES.join(','));
  if (from && to) { u.searchParams.set('from', from); u.searchParams.set('to', to); }
  return parseFrankfurter(await getJson(u.toString()), to ?? today());
}

async function fetchFallback(): Promise<Rate[]> {
  const d = (await getJson(config.fx.fallbackUrl)) as { result?: string; rates?: Record<string, number> };
  if (d.result !== 'success' || !d.rates) throw new Error('resposta inválida da API reserva');
  const t = today();
  return QUOTES.filter((c) => d.rates![c] > 0).map((c) => ({ date: t, currency: c, rate: d.rates![c] }));
}

/** Salva as taxas e preenche os dias faltantes até hoje com a última taxa conhecida. */
async function save(rates: Rate[], source: string) {
  if (!rates.length) return;
  await tx(async (c) => {
    for (const r of rates) {
      await c.query(`INSERT INTO currency_rates (date, currency, rate_per_usd, source, fetched_at) VALUES ($1, $2, $3, $4, now())
                     ON CONFLICT (date, currency) DO UPDATE SET rate_per_usd = EXCLUDED.rate_per_usd, source = EXCLUDED.source, fetched_at = now()`, [r.date, r.currency, r.rate, source]);
    }
    // carry-forward: todo dia sem linha recebe a taxa do último dia anterior que tem
    await c.query(`
      INSERT INTO currency_rates (date, currency, rate_per_usd, source, fetched_at)
      SELECT d::date, cur.c, prev.rate_per_usd, prev.source || ' (repetida)', now()
        FROM (SELECT unnest($1::text[]) AS c) cur
        CROSS JOIN generate_series((SELECT min(date) FROM currency_rates), $2::date, interval '1 day') d
        CROSS JOIN LATERAL (SELECT rate_per_usd, source FROM currency_rates p WHERE p.currency = cur.c AND p.date < d::date ORDER BY p.date DESC LIMIT 1) prev
       WHERE NOT EXISTS (SELECT 1 FROM currency_rates x WHERE x.currency = cur.c AND x.date = d::date)
      ON CONFLICT DO NOTHING`, [QUOTES, today()]);
  });
}

/** Busca a cotação de hoje (e os dias que faltarem desde a última). Usado pelo agendador e por POST /admin/fx/refresh. */
export async function refreshRates(): Promise<{ source: string; count: number }> {
  const last = await one<{ d: string | null }>('SELECT max(date)::text AS d FROM currency_rates WHERE source NOT LIKE \'%(repetida)\'');
  const t = today();
  const from = last?.d && daysBetween(last.d, t) > 1 ? addDays(last.d, 1) : undefined;
  try {
    const rates = await fetchFrankfurter(from, from ? t : undefined);
    await save(rates, 'Frankfurter');
    return { source: 'Frankfurter', count: rates.length };
  } catch (e) {
    console.warn('[fx] Frankfurter falhou, usando reserva:', (e as Error).message);
    const rates = await fetchFallback();
    await save(rates, 'open.er-api.com');
    return { source: 'open.er-api.com', count: rates.length };
  }
}

/** Na primeira subida (tabela vazia), baixa o histórico para converter os dados antigos. */
export async function backfillIfEmpty() {
  const c = await one<{ n: number }>('SELECT count(*)::int AS n FROM currency_rates');
  if (c && c.n > 0) return;
  const t = today();
  const from = addDays(t, -config.fx.backfillDays);
  try {
    const rates = await fetchFrankfurter(from, t);
    await save(rates, 'Frankfurter');
    console.log(`[fx] histórico carregado: ${rates.length} taxas desde ${from}`);
  } catch (e) {
    console.warn('[fx] não foi possível baixar o histórico agora:', (e as Error).message);
    await refreshRates().catch((x) => console.warn('[fx] sem cotação no boot:', (x as Error).message));
  }
}

export async function latest() {
  const rows = await q<{ currency: Quote; rate_per_usd: number; fetched_at: string; source: string; date: string }>(
    `SELECT DISTINCT ON (currency) currency, rate_per_usd, fetched_at, source, date::text FROM currency_rates ORDER BY currency, date DESC`);
  const by = Object.fromEntries(rows.map((r) => [r.currency, r]));
  const newest = rows.reduce<string | null>((a, r) => (!a || r.fetched_at > a ? r.fetched_at : a), null);
  const disc = await currentDiscount();
  const brl = by.BRL?.rate_per_usd != null ? Number(by.BRL.rate_per_usd) : null;
  return {
    base: 'USD' as const,
    rates: { USD: 1, BRL: by.BRL?.rate_per_usd ?? null, EUR: by.EUR?.rate_per_usd ?? null },
    /** Deságio (R$) e a cotação USD/BRL usada na receita do Ad Manager (cotação − deságio). */
    brlDiscount: disc?.amount ?? 0,
    brlDiscountFrom: disc?.validFrom ?? null,
    brlRevenueRate: brl != null ? Math.max(0.0001, brl - (disc?.amount ?? 0)) : null,
    fetchedAt: newest ? new Date(newest).toISOString() : null,
    source: (by.BRL?.source ?? 'sem cotação').replace(' (repetida)', '') + (by.BRL ? ` · taxa de ${by.BRL.date}` : ''),
  };
}

export async function history(days: number) {
  const rows = await q<{ date: string; BRL: number; EUR: number }>(
    `SELECT date::text, max(rate_per_usd) FILTER (WHERE currency = 'BRL') AS "BRL", max(rate_per_usd) FILTER (WHERE currency = 'EUR') AS "EUR"
       FROM currency_rates WHERE date > $1::date - $2::int GROUP BY date ORDER BY date DESC`, [today(), days]);
  return { rows };
}

/* ---------------- deságio ---------------- */
/** Deságio vigente hoje (R$ por US$). */
export async function currentDiscount(): Promise<{ amount: number; validFrom: string } | null> {
  const r = await q<{ amount: string; valid_from: string }>(`SELECT amount_brl AS amount, valid_from::text FROM fx_discounts WHERE valid_from <= CURRENT_DATE ORDER BY valid_from DESC LIMIT 1`);
  return r[0] ? { amount: Number(r[0].amount), validFrom: r[0].valid_from } : null;
}
export async function discountHistory() {
  return (await q<{ amount: string; validFrom: string; createdAt: string; createdBy: string | null }>(`
    SELECT x.amount_brl AS amount, x.valid_from::text AS "validFrom", x.created_at AS "createdAt", u.name AS "createdBy"
      FROM fx_discounts x LEFT JOIN users u ON u.id = x.created_by ORDER BY x.valid_from DESC LIMIT 50`)).map((r) => ({ ...r, amount: Number(r.amount) }));
}
