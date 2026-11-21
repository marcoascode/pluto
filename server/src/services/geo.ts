/**
 * 0.18 · País do visitante pelo IP, para o rastreador do Pluto (routes/collect.ts).
 *
 * Base: DB-IP "IP to Country Lite" (gratuita, CC BY 4.0, atualizada todo mês), baixada pela própria api e mantida
 * SÓ EM MEMÓRIA (nada é gravado em disco). Recarrega a cada 7 dias; se o download falhar, segue com a base anterior
 * e, sem nenhuma, o país fica vazio (a atribuição desse visitante cai para o nível do site, sem país).
 * O IP nunca é gravado: só o código do país (ISO-2) vai para tracker_impressions.
 *
 * GEOIP_URL: endereço alternativo de uma base .mmdb (ou .mmdb.gz) de países, ex.: MaxMind GeoLite2-Country.
 */
import { gunzipSync } from 'node:zlib';
import { Reader, type CountryResponse } from 'maxmind';

const RELOAD_MS = 7 * 86_400_000;
let reader: Reader<CountryResponse> | null = null;
let loadedAt = 0, loading: Promise<void> | null = null;

const month = (offset: number) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - offset); return d.toISOString().slice(0, 7); };
const sources = () => (process.env.GEOIP_URL ? [process.env.GEOIP_URL]
  // a base do mês sai nos primeiros dias; até lá, a do mês anterior
  : [0, 1].map((o) => `https://download.db-ip.com/free/dbip-country-lite-${month(o)}.mmdb.gz`));

async function load() {
  for (const url of sources()) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      let buf = Buffer.from(await r.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
      reader = new Reader<CountryResponse>(buf);
      loadedAt = Date.now();
      console.info(`[geo] base de países carregada (${url.split('/').pop()}, ${Math.round(buf.length / 1024 / 1024)} MB em memória)`);
      return;
    } catch (e) { console.warn(`[geo] falha ao baixar ${url}: ${(e as Error).message}`); }
  }
  loadedAt = Date.now() - RELOAD_MS + 3600_000;   // sem base: tenta de novo em 1 h
}

/** Inicia (ou renova) a base em segundo plano. Nunca bloqueia nem lança. */
export function warmGeo() {
  if (loading || Date.now() - loadedAt < RELOAD_MS) return;
  loading = load().catch(() => {}).finally(() => { loading = null; });
}

/** País ISO-2 (maiúsculo) do IP; '' se desconhecido ou a base ainda não carregou. Header do CDN tem prioridade. */
export function countryOf(ip: string | undefined, cdnHeader?: string | string[]): string {
  const h = Array.isArray(cdnHeader) ? cdnHeader[0] : cdnHeader;
  if (h && /^[A-Z]{2}$/i.test(h) && !/^(XX|T1)$/i.test(h)) return h.toUpperCase();
  warmGeo();
  if (!reader || !ip) return '';
  try { return (reader.get(ip.replace(/^::ffff:/, ''))?.country?.iso_code ?? '').toUpperCase(); } catch { return ''; }
}
