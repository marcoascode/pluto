/**
 * Placements FALSOS (só VITE_API_MOCK=true). O custo e a receita de cada campanha/dia são divididos entre os
 * placements dela, então o total da tela de Placements bate com o total das campanhas.
 * Nomes de sites inventados (.example).
 */
import type { PlacementType } from '@/types/api';
import { CAMPS, ROWS, type Row } from './db';

function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PR = mulberry(20261004);
const pg = () => { let u = 0, v = 0; while (!u) u = PR(); while (!v) v = PR(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
function shuffle<T>(a: T[]) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(PR() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function h32(t: string) { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function hg(t: string) { const u = (h32(t) + 0.5) / 4294967296, v = (h32(t + '#') + 0.5) / 4294967296; return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

const ROOTS = 'noticias-hoje receitas-faceis clima-agora financas-pessoais empregos-ja cursos-gratis saude-em-dia tech-review jogos-online esportes-total viagem-barata moda-e-estilo carros-usados pets-e-cia dicas-de-casa horoscopo-diario resultados-loteria cripto-news bolsa-hoje educacao-online vagas-abertas concursos-ja beleza-natural futebol-ao-vivo filmes-e-series musica-top decoracao-facil agro-noticias imoveis-agora celular-dicas quiz-divertido palavras-cruzadas tradutor-online calculadora-web mapa-rotas previsao-tempo guia-do-estudante bolsas-de-estudo credito-facil seguro-auto receita-fit treino-em-casa maternidade-hoje idiomas-ja resumos-enem curiosidades-mundo'.split(' ');
const SUBS = ['lp', 'm', 'blog', 'amp', 'br', 'es', 'news', 'app'];
const HOSTS: { h: string; q: number }[] = [];
for (const r of ROOTS) {
  const root = r + '.example'; const q = pg() * 0.34 + 0.02; const u = PR();
  if (u < 0.6) HOSTS.push({ h: root, q });
  else if (u < 0.68) HOSTS.push({ h: SUBS[Math.floor(PR() * 3)] + '.' + root, q });
  else { const n = u < 0.9 ? 2 : 3; HOSTS.push({ h: root, q: q + pg() * 0.2 }); shuffle(SUBS.slice()).slice(0, n - 1).forEach((s) => HOSTS.push({ h: s + '.' + root, q: q + pg() * 0.3 })); }
}
HOSTS.push({ h: 'youtube.com', q: -0.05 }, { h: 'mail.google.com', q: -0.35 }, { h: 'mobileapp::2-com.exemplo.palavras', q: -0.85 }, { h: 'mobileapp::2-com.exemplo.paciencia', q: -0.7 }, { h: 'mobileapp::1-100000001', q: -1.2 });
export const PL_LABEL: Record<string, string> = { 'youtube.com': 'YouTube', 'mobileapp::2-com.exemplo.palavras': 'Jogo de Palavras', 'mobileapp::2-com.exemplo.paciencia': 'Paciência Clássica', 'mobileapp::1-100000001': 'Lanterna Pro' };

/** Igual ao servidor (services/sync/placements.ts). */
const PSL2 = new Set(['com.br', 'net.br', 'org.br', 'co.uk', 'com.mx', 'com.ar', 'com.co', 'com.es', 'com.au']);
export function rootOf(k: string) { if (k.includes('::')) return k; const l = k.split('.'); if (l.length <= 2) return k; return l.slice(PSL2.has(l.slice(-2).join('.')) ? -3 : -2).join('.'); }
export function typeOf(k: string): PlacementType { return k.includes('::') ? 'app' : k === 'youtube.com' ? 'youtube' : /(^|\.)google\.com$/.test(k) ? 'google' : 'website'; }

const BYROOT = new Map<string, { h: string; q: number }[]>();
for (const x of HOSTS) { const rt = rootOf(x.h); if (!BYROOT.has(rt)) BYROOT.set(rt, []); BYROOT.get(rt)!.push(x); }
const PER_CAMP = new Map<string, { h: string; root: string; w: number; b: number }[]>();
for (const c of CAMPS.filter((x) => x.platform === 'google')) {
  const roots = shuffle([...BYROOT.keys()]); const k = 14 + Math.floor(PR() * 14); const list: { h: string; root: string; w: number; b: number }[] = [];
  for (const rt of roots.slice(0, k)) for (const x of BYROOT.get(rt)!) list.push({ h: x.h, root: rt, w: Math.exp(pg() * 1.05), b: x.q + pg() * 0.18 });
  PER_CAMP.set(c.id, list);
}

export type PRow = Row & { host: string; root: string };
const SPEND_SIDE = ['spendUSD', 'clk', 'tImps', 'sess'] as const;            // tráfego segue o custo
const REV_SIDE = ['revUSD', 'grossUSD', 'adImps', 'rsv', 'adReq', 'adClk', 'view'] as const; // monetização segue a receita
const cache = new Map<string, PRow[]>();

/** Linhas de placement das campanhas nos dias [a, b] (índices de DATES, 0 = hoje). */
export function placementRows(campIds: string[], a: number, b: number): PRow[] {
  const key = campIds.slice().sort().join(',') + '|' + a + '|' + b;
  if (cache.has(key)) return cache.get(key)!;
  const set = new Set(campIds); const cd = new Map<string, Row>();
  for (const r of ROWS) {
    if (r.src !== 'google' || !r.camp || !set.has(r.camp) || r.di < a || r.di > b) continue;
    const k = r.camp + '|' + r.di; const x = cd.get(k);
    if (!x) cd.set(k, { ...r }); else { for (const f of [...SPEND_SIDE, ...REV_SIDE]) (x[f] as number) += r[f] as number; }
  }
  const out: PRow[] = [];
  for (const x of cd.values()) {
    const L = PER_CAMP.get(x.camp!); if (!L) continue; let sw = 0, rw = 0;
    const ws = L.map((p) => { const sp = p.w * Math.exp(hg(x.camp! + p.h + x.di) * 0.35); const rv = sp * Math.exp(p.b + hg(p.h + x.di + x.camp!) * 0.28); sw += sp; rw += rv; return [sp, rv]; });
    L.forEach((p, i) => {
      const fs = ws[i][0] / sw, fr = ws[i][1] / rw;
      if (x.spendUSD * fs < 0.004 && x.revUSD * fr < 0.004) return;
      const row = { ...x, host: p.h, root: p.root } as PRow;
      for (const f of SPEND_SIDE) (row[f] as number) = (x[f] as number) * fs;
      for (const f of REV_SIDE) (row[f] as number) = (x[f] as number) * fr;
      out.push(row);
    });
  }
  if (cache.size > 40) cache.clear();
  cache.set(key, out);
  return out;
}
