/**
 * 0.18 · Parametrização automática de URL das campanhas Meta.
 * Reaproveita o template de UTM do Pluto (app_settings.utm_templates, o mesmo da tela de UTMs/debug), então o que o
 * criador de campanhas injeta é exatamente o que o atribuidor de receita (metrics.ts → /utm/debug) sabe ler.
 *
 * As macros da Meta ({{campaign.id}}, {{adset.id}}, {{ad.id}}, {{site_source_name}}, {{placement}}) NÃO podem ser
 * codificadas na URL: vão no campo `url_tags` do anúncio (a Meta as resolve na entrega). Por isso devolvemos o link limpo
 * e as tags separados, mais um preview legível. A montagem é manual, nunca com URLSearchParams (que codificaria as chaves).
 */
import { one } from '../db.js';
import { HttpError } from '../lib/http.js';

export async function utmTemplates(): Promise<{ google: string; meta: string }> {
  return (await one<{ value: { google: string; meta: string } }>(`SELECT value FROM app_settings WHERE key = 'utm_templates'`))?.value ?? { google: '', meta: '' };
}

export interface TrackedUrl {
  /** Link de destino limpo (sem utm_*), para o campo `link` do criativo. */
  link: string;
  /** Template Meta para o campo `url_tags` do anúncio (macros intactas). */
  urlTags: string;
  /** link + ? + urlTags, só para conferência visual (e para colar no /utm/debug depois de resolvidas as macros). */
  preview: string;
  /** Parâmetros utm_* que vinham na URL informada e foram descartados em favor do template. */
  replaced: string[];
}

const strip = (h: string) => h.replace(/^www\./, '').toLowerCase();

/**
 * Valida a URL de destino (https, sem credenciais, host = o site selecionado ou subdomínio dele) e injeta o template Meta.
 * Parâmetros que não são de rastreamento (ex.: ?id=12) são preservados; utm_*, fbclid e gclid são trocados pelo template.
 */
export async function buildMetaTrackedUrl(rawUrl: string, siteHostname: string): Promise<TrackedUrl> {
  let u: URL;
  try { u = new URL(rawUrl.trim()); } catch { throw new HttpError(422, 'invalid_url', 'URL de destino inválida. Informe a URL completa, começando com https://'); }
  if (u.protocol !== 'https:') throw new HttpError(422, 'invalid_url', 'A URL de destino precisa ser https.');
  if (u.username || u.password) throw new HttpError(422, 'invalid_url', 'A URL de destino não pode conter usuário/senha.');
  const host = strip(u.hostname), site = strip(siteHostname);
  if (host !== site && !host.endsWith(`.${site}`)) throw new HttpError(422, 'url_outside_site', `A URL de destino precisa ser do site selecionado (${site}).`);

  const replaced: string[] = [];
  for (const k of [...u.searchParams.keys()]) {
    if (/^utm_/i.test(k) || k === 'fbclid' || k === 'gclid') { if (!replaced.includes(k)) replaced.push(k); u.searchParams.delete(k); }
  }
  u.hash = '';
  const link = u.toString();

  const urlTags = (await utmTemplates()).meta.trim().replace(/^[?&]+/, '');
  if (!urlTags) throw new HttpError(409, 'utm_template_missing', 'O template de UTM da Meta não está configurado (Admin → UTMs).');
  return { link, urlTags, preview: `${link}${link.includes('?') ? '&' : '?'}${urlTags}`, replaced };
}
