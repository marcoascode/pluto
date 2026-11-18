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

/* ---------------- 0.18 · auditoria do sufixo dos anúncios Meta (Admin → UTMs) ---------------- */

/** "a=1&b={{ad.id}}" → Map. Manual (como acima): as macros {{…}} ficam intactas; valor sem decodificação possível fica cru. */
export function parseParams(s: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of s.replace(/^[?&]+/, '').split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const rawK = i < 0 ? part : part.slice(0, i), rawV = i < 0 ? '' : part.slice(i + 1);
    const dec = (x: string) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch { return x; } };
    const k = dec(rawK).trim().toLowerCase();
    if (k && !out.has(k)) out.set(k, dec(rawV).trim());   // chave repetida: vale a 1ª (é o que qs.get() do site lê)
  }
  return out;
}

export type MetaTagStatus = 'ok' | 'missing' | 'different' | 'unread';
export interface MetaTagAudit {
  status: MetaTagStatus;
  /** utm_* efetivos do anúncio: os da query do link e, para as chaves que faltarem, os do url_tags (a Meta concatena os dois). */
  params: Record<string, string>;
  /** Fora do padrão, mas o sync do Ad Manager ainda atribui (formato antigo {{campaign.id}} / {{adset.id}}_{{ad.id}}). */
  attributable: boolean;
}

/**
 * Compara os parâmetros efetivos do anúncio com o template Meta (app_settings.utm_templates.meta):
 *   ok        todas as chaves do template presentes e iguais
 *   missing   nenhuma chave do template presente (a receita vira "sem campanha" no Ad Manager)
 *   different alguma chave ausente ou com outro valor
 *   unread    url_tags ainda não lido pelo sync de estrutura (NULL)
 */
export function auditMetaTags(link: string | null, urlTags: string | null, template: string): MetaTagAudit {
  const q = link && link.includes('?') ? link.slice(link.indexOf('?') + 1).split('#')[0] : '';
  const eff = parseParams(q);
  for (const [k, v] of parseParams(urlTags ?? '')) if (!eff.has(k)) eff.set(k, v);
  const params = Object.fromEntries([...eff].filter(([k]) => k.startsWith('utm_')));
  const tpl = parseParams(template);
  const camp = eff.get('utm_campaign') ?? '', head = (eff.get('utm_content') ?? '').split('_')[0];
  const attributable = ['{{ad.id}}', '{{campaign.id}}'].includes(camp) && ['{{ad.id}}', '{{adset.id}}'].includes(head);
  if (urlTags == null && !Object.keys(params).length) return { status: 'unread', params, attributable: false };
  const keys = [...tpl.keys()];
  if (keys.length && keys.every((k) => eff.get(k) === tpl.get(k))) return { status: 'ok', params, attributable: true };
  if (keys.every((k) => !eff.get(k))) return { status: 'missing', params, attributable: false };
  return { status: 'different', params, attributable };
}
