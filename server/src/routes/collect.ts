/**
 * 0.18 · Coleta do rastreador próprio (script do Pluto nos sites WordPress). Pública, sem sessão.
 *
 *  POST /collect   (https://app.plutomidia.com.br/api/collect)
 *       corpo text/plain (navigator.sendBeacon, sem preflight de CORS):
 *       {"h":"site.com","c":"<utm_campaign>","ct":"<utm_content>","s":"<utm_source>","pv":1,"im":3}
 *       pv = páginas vistas, im = impressões renderizadas pelo GPT desde o último envio.
 *  v1.2 (v: 2) também manda as visitas SEM UTM e, por impressão, o bloco e o dispositivo:
 *       {"v":2,"h":"site.com","c":"","ct":"","s":"","pv":1,"im":3,"d":"smartphone","u":{"/1234/site/topo":2,"/1234/site/meio":1}}
 *       → tracker_impressions (dia × site × UTMs × bloco × país × dispositivo). O país vem do IP (services/geo.ts),
 *       que não é gravado.
 *
 * Só aceita sites cadastrados em Domínios (e Origin do mesmo site, quando o navegador manda). Os envios são somados
 * em memória e gravados em tracker_daily a cada 10 s (um UPSERT por lote). Sempre responde 204: o site nunca espera.
 */
import express, { Router } from 'express';
import { q } from '../db.js';
import { today } from '../lib/dates.js';
import { countryOf, warmGeo } from '../services/geo.js';

export const collectRouter = Router();

const FLUSH_MS = 10_000;
const MAX_IM = 200, MAX_PV = 50;
/** valores de UTM: até 100 caracteres, sem controle; macros não resolvidas ({{…}}) descartadas */
const clean = (v: unknown) => {
  if (typeof v !== 'string') return '';
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
  return /[{}]/.test(s) ? '' : s;
};
const DEVICES = new Set(['desktop', 'smartphone', 'tablet']);
const MAX_UNITS = 40;
/** caminho do bloco no GPT: /rede[,filho]/a/b — até 200 caracteres */
const unitPath = (v: string) => (v.length <= 200 && /^\/[\w\-.,/]+$/.test(v) ? v : '');
const count = (v: unknown, max: number) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(0, Math.floor(Number(v)))) : 0);
const host = (h: string) => h.trim().toLowerCase().replace(/^www\./, '');

let domains = new Map<string, string>(), domainsAt = 0;
async function domainId(h: string): Promise<string | undefined> {
  if (Date.now() - domainsAt > 5 * 60_000) {
    domains = new Map((await q<{ id: string; hostname: string }>('SELECT id::text, hostname FROM domains WHERE NOT is_technical')).map((d) => [host(d.hostname), d.id]));
    domainsAt = Date.now();
  }
  return domains.get(host(h));
}

/** 300 envios por minuto por IP (um visitante manda poucos; acima disso é abuso). */
const hits = new Map<string, { n: number; at: number }>();
const limited = (ip: string) => {
  const now = Date.now(), x = hits.get(ip);
  if (!x || now - x.at > 60_000) { hits.set(ip, { n: 1, at: now }); return false; }
  return ++x.n > 300;
};

type Agg = { date: string; dom: string; c: string; ct: string; s: string; pv: number; im: number };
type UAgg = { date: string; dom: string; c: string; ct: string; s: string; unit: string; cc: string; dev: string; im: number };
let buf = new Map<string, Agg>();
let ubuf = new Map<string, UAgg>();
async function flush() {
  if (ubuf.size) {
    const u = [...ubuf.values()]; ubuf = new Map();
    try {
      await q(`
        INSERT INTO tracker_impressions (date, domain_id, utm_campaign, utm_content, utm_source, ad_unit, country, device, impressions)
        SELECT * FROM unnest($1::date[], $2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::bigint[])
        ON CONFLICT (date, domain_id, utm_campaign, utm_content, utm_source, ad_unit, country, device)
        DO UPDATE SET impressions = tracker_impressions.impressions + EXCLUDED.impressions, updated_at = now()`,
      [u.map((r) => r.date), u.map((r) => r.dom), u.map((r) => r.c), u.map((r) => r.ct), u.map((r) => r.s), u.map((r) => r.unit), u.map((r) => r.cc), u.map((r) => r.dev), u.map((r) => r.im)]);
    } catch (e) { console.error('[collect] falha ao gravar impressões por bloco', (e as Error).message); }
  }
  if (!buf.size) return;
  const rows = [...buf.values()]; buf = new Map();
  try {
    await q(`
      INSERT INTO tracker_daily (date, domain_id, utm_campaign, utm_content, utm_source, pageviews, impressions)
      SELECT * FROM unnest($1::date[], $2::bigint[], $3::text[], $4::text[], $5::text[], $6::bigint[], $7::bigint[])
      ON CONFLICT (date, domain_id, utm_campaign, utm_content, utm_source)
      DO UPDATE SET pageviews = tracker_daily.pageviews + EXCLUDED.pageviews, impressions = tracker_daily.impressions + EXCLUDED.impressions, updated_at = now()`,
    [rows.map((r) => r.date), rows.map((r) => r.dom), rows.map((r) => r.c), rows.map((r) => r.ct), rows.map((r) => r.s), rows.map((r) => r.pv), rows.map((r) => r.im)]);
  } catch (e) { console.error('[collect] falha ao gravar lote', (e as Error).message); }
  if (hits.size > 50_000) hits.clear();
}
warmGeo();
const timer = setInterval(() => { void flush(); }, FLUSH_MS);
timer.unref();
export const flushCollect = flush;

collectRouter.post('/collect', express.text({ type: '*/*', limit: '4kb' }), async (req, res) => {
  res.status(204).end();
  try {
    if (limited(req.ip ?? '')) return;
    const b = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;
    const h = typeof b.h === 'string' ? b.h : '';
    const origin = req.headers.origin;
    if (origin) { try { if (host(new URL(origin).hostname) !== host(h)) return; } catch { return; } }
    const dom = h && (await domainId(h));
    if (!dom) return;
    const pv = count(b.pv, MAX_PV), im = count(b.im, MAX_IM);
    if (!pv && !im) return;
    const a: Agg = { date: today(), dom, c: clean(b.c), ct: clean(b.ct), s: clean(b.s).toLowerCase(), pv, im };
    const v2 = Number(b.v) >= 2;
    // v1.1 só manda visitas com UTM (só macros não resolvidas: nada a atribuir); v1.2 manda as orgânicas também
    if (!v2 && !a.c && !a.ct && !a.s) return;
    if (v2 && b.u && typeof b.u === 'object' && !Array.isArray(b.u)) {
      const cc = countryOf(req.ip, req.headers['cf-ipcountry']);
      const dev = typeof b.d === 'string' && DEVICES.has(b.d) ? b.d : '';
      let left = MAX_IM;
      for (const [path, n] of Object.entries(b.u as Record<string, unknown>).slice(0, MAX_UNITS)) {
        const unit = unitPath(path), k2 = count(n, left);
        if (!unit || !k2) continue;
        left -= k2;
        const uk = [a.date, a.dom, a.c, a.ct, a.s, unit, cc, dev].join('\u0001');
        const ux = ubuf.get(uk);
        if (ux) ux.im += k2; else ubuf.set(uk, { date: a.date, dom: a.dom, c: a.c, ct: a.ct, s: a.s, unit, cc, dev, im: k2 });
      }
    }
    const k = [a.date, a.dom, a.c, a.ct, a.s].join('\u0001');
    const x = buf.get(k);
    if (x) { x.pv += pv; x.im += im; } else buf.set(k, a);
  } catch { /* corpo inválido: ignora */ }
});
