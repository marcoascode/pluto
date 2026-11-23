/**
 * Placements do Google Ads × receita do Ad Manager.
 * Fluxo da tela: 1) domínio (obrigatório) → 2) contas Google Ads do domínio → 3) campanhas → pesquisa.
 *   GET /placements/filters?domain=            contas e campanhas Google do domínio (para os seletores)
 *   GET /placements?domain=&accounts=&campaigns=&from&to
 *                                              placements agrupados pelo domínio principal + totais + comparação
 *   GET /placements/campaigns?…&placement=&level=root|host   campanhas que gastaram naquele placement
 * Escopo: scope() + canSeeCampaign (Gestor só as campanhas das contas dele) + permissão de Google Ads.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { HttpError, parse } from '../lib/http.js';
import { requireCap } from '../auth/session.js';
import { canSeeCampaign, scope } from '../auth/scope.js';
import { toMetrics, type Metrics } from '../services/metrics.js';
import { aggregatePlacements, placementRoiDays } from '../services/placements.js';
import { placementType } from '../services/sync/placements.js';
import { d3, period, previous } from './metrics.js';

export const placementsRouter = Router();
placementsRouter.use(requireCap('campaigns.google.view'));

interface GCamp { db_id: string; id: string; name: string; status: string; account_id: string; account_name: string; account_ext: string }

async function domainCampaigns(req: Request) {
  const host = String(req.query.domain ?? '').trim();
  if (!host) throw new HttpError(422, 'domain_required', 'Escolha um domínio.');
  const sc = await scope(req, host);
  const camps = await q<GCamp>(`
    SELECT c.id::text AS db_id, c.external_id AS id, c.name, c.status, a.id::text AS account_id, a.name AS account_name, a.external_id AS account_ext
      FROM campaigns c JOIN integration_accounts a ON a.id = c.account_id
     WHERE c.domain_id = $1 AND c.platform = 'google' AND c.status <> 'REMOVED'
     ORDER BY c.name`, [sc.ids[0]]);
  // Gestor: só as campanhas das contas dele neste domínio
  return { domainId: sc.ids[0], host: sc.hosts[0], camps: camps.filter((c) => canSeeCampaign(sc, c.db_id, sc.ids[0])) };
}
const csv = (v: unknown) => (typeof v === 'string' && v ? v.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 500) : []);

/** Contas e campanhas escolhidas. Lista vazia = todas do domínio. */
async function selection(req: Request) {
  const d = await domainCampaigns(req);
  const accs = csv(req.query.accounts);
  const ids = csv(req.query.campaigns);
  const inAcc = d.camps.filter((c) => !accs.length || accs.includes(c.account_id));
  const use = inAcc.filter((c) => !ids.length || ids.includes(c.id));
  return { ...d, accs, inAcc, use };
}

placementsRouter.get('/filters', async (req, res) => {
  const d = await domainCampaigns(req);
  const accounts = [...new Map(d.camps.map((c) => [c.account_id, { id: c.account_id, name: c.account_name, externalId: c.account_ext, campaigns: d.camps.filter((x) => x.account_id === c.account_id).length }])).values()];
  res.json({ domain: d.host, accounts, campaigns: d.camps.map((c) => ({ id: c.id, name: c.name, accountId: c.account_id, status: c.status === 'PAUSED' ? 'PAUSED' : 'ENABLED' })) });
});

/**
 * 0.15 · Subdomínios com -100%: o Google Ads informa o custo por subdomínio (6549.site.com), mas a receita do
 * Ad Manager pode chegar só no domínio principal (site.com), porque o {placement} da URL não traz o subdomínio.
 * Aí cada subdomínio aparecia só com custo (-100%) e o principal com a receita toda.
 * Quando NENHUM subdomínio tem receita e o principal tem, a receita do principal é distribuída entre os
 * subdomínios pela proporção do custo (dia a dia nos ROIs D-x) e a linha vem marcada como estimated.
 * O total do domínio não muda. Se algum subdomínio tiver receita própria, nada é estimado.
 */
type HostRow = { key: string; metrics: Metrics; roiDays?: { today: number | null; d1: number | null; d2: number | null; d3: number | null }; recent?: [number, number][]; estimated?: boolean };
export function spreadRootRevenue<T extends HostRow>(root: string, hosts: T[]): T[] {
  const own = hosts.find((h) => h.key === root);
  const subs = hosts.filter((h) => h.key !== root);
  if (!own || !subs.length || own.metrics.revenue <= 0 || subs.some((h) => h.metrics.revenue > 0)) return hosts;
  const spend = hosts.reduce((a, h) => a + h.metrics.spend, 0);
  if (spend <= 0) return hosts;
  const rev = own.metrics.revenue, gross = own.metrics.grossRevenue;
  const fix = (m: Metrics, r: number, g: number): Metrics => {
    const profit = r - m.spend;
    return { ...m, revenue: r, grossRevenue: g, profit, roi: m.spend > 0 ? (profit / m.spend) * 100 : null, margin: r > 0 ? (profit / r) * 100 : null, ecpm: null, cpcAdx: null };
  };
  // ROI D-x: mesma divisão, pelo custo de cada dia
  const dayTot = [0, 1, 2, 3].map((i) => hosts.reduce((a, h) => a + (h.recent?.[i]?.[0] ?? 0), 0));
  const dayRev = [0, 1, 2, 3].map((i) => own.recent?.[i]?.[1] ?? 0);
  return hosts.map((h) => {
    const sh = h.metrics.spend / spend;
    const recent = h.recent?.map(([sp], i): [number, number] => [sp, dayTot[i] > 0 ? dayRev[i] * (sp / dayTot[i]) : 0]);
    const roi = (i: number) => (recent && recent[i][0] > 0 ? ((recent[i][1] - recent[i][0]) / recent[i][0]) * 100 : null);
    return { ...h, metrics: fix(h.metrics, rev * sh, gross * sh), ...(recent ? { recent, roiDays: { today: roi(0), d1: roi(1), d2: roi(2), d3: roi(3) } } : {}), estimated: true };
  }).filter((h) => h.key !== root || h.metrics.spend > 0);   // o principal sem custo próprio some (a receita dele foi para os subdomínios)
}

placementsRouter.get('/', async (req, res) => {
  const p = period(req);
  const s = await selection(req);
  const base = { domainId: s.domainId, campaignIds: s.use.map((c) => c.db_id) };
  const prev = previous(p.from, p.to, p.today);
  const SEP = `m.placement_root || '|' || m.placement`;
  const [totals, cmp, trd, byHost, hostRd, rootRd] = await Promise.all([
    aggregatePlacements({ ...base, from: p.from, to: p.to }).then((m) => m.get('') ?? toMetrics()),
    prev ? aggregatePlacements({ ...base, ...prev }).then((m) => m.get('') ?? toMetrics()) : null,
    placementRoiDays({ ...base, key: `''`, today: p.today, d3: d3(p.today) }),
    aggregatePlacements({ ...base, from: p.from, to: p.to, groupBy: SEP }),
    placementRoiDays({ ...base, key: 'm.placement', today: p.today, d3: d3(p.today) }),
    placementRoiDays({ ...base, key: 'm.placement_root', today: p.today, d3: d3(p.today) }),
  ]);
  const byRoot = await aggregatePlacements({ ...base, from: p.from, to: p.to, groupBy: 'm.placement_root' });
  const keys = [...byHost.keys()].map((k) => { const i = k.indexOf('|'); return { root: k.slice(0, i), host: k.slice(i + 1), k }; });
  const labels = new Map((await q<{ placement: string; label: string }>('SELECT placement, label FROM placement_labels WHERE placement = ANY($1::text[])',
    [[...new Set(keys.flatMap((x) => [x.root, x.host]))]])).map((r) => [r.placement, r.label]));
  const label = (k: string) => labels.get(k) ?? (k.startsWith('mobileapp::') ? k.slice(11) : k);
  const groups = [...byRoot].map(([root, metrics]) => ({
    key: root, label: label(root), type: placementType(root), metrics, roiDays: rootRd(root), recent: rootRd.recent(root),
    children: spreadRootRevenue(root, keys.filter((x) => x.root === root).map((x) => ({ key: x.host, label: label(x.host), type: placementType(x.host), metrics: byHost.get(x.k)!, roiDays: hostRd(x.host), recent: hostRd.recent(x.host) }))),
  }));
  res.json({
    domain: s.host,
    selection: { accounts: s.accs.length, accountsTotal: new Set(s.camps.map((c) => c.account_id)).size, campaigns: s.use.length, campaignsTotal: s.inAcc.length },
    comparison: prev && cmp ? { ...prev, metrics: cmp } : null,
    totals, totalsRoiDays: trd(''), groups,
  });
});

placementsRouter.get('/campaigns', async (req, res) => {
  const p = period(req);
  const s = await selection(req);
  const placement = parse(z.string().min(1).max(200), req.query.placement);
  const level = req.query.level === 'host' ? 'host' : 'root';
  const base = { domainId: s.domainId, campaignIds: s.use.map((c) => c.db_id), where: `m.${level === 'host' ? 'placement' : 'placement_root'} = $6`, params: [placement] };
  const [totals, byCamp, byHost] = await Promise.all([
    aggregatePlacements({ ...base, from: p.from, to: p.to }).then((m) => m.get('') ?? toMetrics()),
    aggregatePlacements({ ...base, from: p.from, to: p.to, groupBy: 'm.campaign_id' }),
    level === 'root' ? aggregatePlacements({ ...base, from: p.from, to: p.to, groupBy: 'm.placement' }) : Promise.resolve(new Map()),
  ]);
  res.json({
    placement, level, totals,
    hosts: level === 'root' ? spreadRootRevenue(placement, [...byHost].map(([key, metrics]) => ({ key, metrics }))) : [...byHost].map(([key, metrics]) => ({ key, metrics })),
    campaigns: s.use.filter((c) => byCamp.has(c.db_id)).map((c) => ({ id: c.id, name: c.name, accountName: c.account_name, status: c.status === 'PAUSED' ? 'PAUSED' : 'ENABLED', metrics: byCamp.get(c.db_id)! })),
  });
});
