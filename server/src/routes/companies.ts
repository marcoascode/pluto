/**
 * Empresas para quem está vendo o painel (seletor "Empresa" do topo e tela da Empresa).
 *   GET /me/companies                      Empresas visíveis com sócios, Squads e domínios (só os domínios que o usuário vê)
 *   GET /companies/:id/overview?from&to&currency   totais, comparação, série diária e Squads → domínios → gestores
 */
import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { notFound, parse } from '../lib/http.js';
import { addDays } from '../lib/dates.js';
import { companyScope, scopeWithoutCompany, visibleCompanyIds } from '../auth/scope.js';
import { aggregate, toMetrics, type Metrics } from '../services/metrics.js';
import { period, previous } from './metrics.js';

export const companiesReadRouter = Router();

interface CoRow { id: string; name: string }
interface SqRow { id: string; name: string; company_id: string | null }
interface DomRow { id: string; hostname: string; squad_id: string }

async function structure(coIds: string[], visibleDomainIds: Set<string>) {
  const [cos, partners, squads, doms, gestores] = await Promise.all([
    q<CoRow>('SELECT id::text, name FROM companies WHERE id = ANY($1::bigint[]) ORDER BY name', [coIds]),
    q<{ company_id: string; id: string; name: string; role: string }>('SELECT cu.company_id::text, u.id::text, u.name, u.role FROM company_users cu JOIN users u ON u.id = cu.user_id WHERE cu.company_id = ANY($1::bigint[]) ORDER BY u.name', [coIds]),
    q<SqRow>('SELECT id::text, name, company_id::text FROM squads WHERE company_id = ANY($1::bigint[]) ORDER BY name', [coIds]),
    q<DomRow>('SELECT d.id::text, d.hostname, sd.squad_id::text FROM squad_domains sd JOIN domains d ON d.id = sd.domain_id JOIN squads s ON s.id = sd.squad_id WHERE s.company_id = ANY($1::bigint[]) AND d.active ORDER BY d.hostname', [coIds]),
    q<{ domain_id: string; id: string; name: string }>('SELECT dm.domain_id::text, u.id::text, u.name FROM domain_managers dm JOIN users u ON u.id = dm.user_id ORDER BY u.name'),
  ]);
  const vis = doms.filter((d) => visibleDomainIds.has(d.id));
  return cos.map((c) => ({
    id: c.id, name: c.name,
    partners: partners.filter((p) => p.company_id === c.id).map((p) => ({ id: p.id, name: p.name, role: p.role })),
    squads: squads.filter((s) => s.company_id === c.id).map((s) => ({
      id: s.id, name: s.name,
      domains: vis.filter((d) => d.squad_id === s.id).map((d) => ({ id: d.id, domain: d.hostname, gestores: gestores.filter((g) => g.domain_id === d.id).map((g) => ({ id: g.id, name: g.name })) })),
    })).filter((s) => s.domains.length > 0),   // Squad sem domínio visível para este usuário não aparece
  }));
}

companiesReadRouter.get('/me/companies', async (req, res) => {
  const [ids, sc] = await Promise.all([visibleCompanyIds(req), scopeWithoutCompany(req)]);
  const list = await structure(ids, new Set(sc.ids));
  res.json({ companies: list.map((c) => ({ id: c.id, name: c.name, partners: c.partners, squads: c.squads.map((s) => ({ id: s.id, name: s.name, domains: s.domains.map((d) => d.domain) })), domains: c.squads.flatMap((s) => s.domains.map((d) => d.domain)) })) });
});

companiesReadRouter.get('/companies/:id/overview', async (req, res) => {
  const id = parse(z.string().regex(/^\d+$/), req.params.id);
  const p = period(req);
  const sc = await companyScope(req, id);   // 403 se a Empresa não for visível
  const [co] = await structure([id], new Set(sc.ids));
  if (!co) throw notFound('Empresa não encontrada.');
  const base = { domainIds: sc.ids, filter: sc.filter, currency: p.currency };
  const prev = previous(p.from, p.to, p.today);
  const dailyFrom = p.from < addDays(p.to, -13) ? p.from : addDays(p.to, -13);
  const [tot, cmp, byDom, daily] = await Promise.all([
    aggregate({ ...base, from: p.from, to: p.to }),
    prev ? aggregate({ ...base, ...prev }) : null,
    aggregate({ ...base, from: p.from, to: p.to, groupBy: 'm.domain_id' }),
    aggregate({ ...base, from: dailyFrom, to: p.to, groupBy: 'm.date' }),
  ]);
  const sum = (ms: Metrics[]) => {   // soma dos domínios do Squad (mesmas fórmulas: soma as bases e recalcula)
    const k = (f: keyof Metrics) => ms.reduce((a, m) => a + ((m[f] as number) || 0), 0);
    return toMetrics({ spend: k('spend'), gs: k('googleSpend'), ms: k('metaSpend'), iva: k('iva'), rev: k('revenue'), gross: k('grossRevenue'), un: k('unattributedRevenue'), sess: k('sessions'), ai: k('impressions'), ar: k('adRequests'), rsv: k('responsesServed'), ac: k('adClicks'),
      vw: ms.reduce((a, m) => a + (m.viewability ?? 0) * m.impressions / 100, 0), clk: k('trafficClicks'), ti: k('trafficImpressions'), n: ms.length });
  };
  const days: { date: string; partial: boolean; metrics: Metrics }[] = [];
  for (let d = p.to; d >= dailyFrom; d = addDays(d, -1)) days.push({ date: d, partial: d === p.today, metrics: daily.get(d) ?? toMetrics() });
  res.json({
    company: { id: co.id, name: co.name, partners: co.partners },
    period: { from: p.from, to: p.to },
    comparison: prev && cmp ? { ...prev, metrics: cmp.get('') ?? toMetrics() } : null,
    totals: tot.get('') ?? toMetrics(),
    daily: days,
    squads: co.squads.map((s) => {
      const doms = s.domains.map((d) => ({ domain: d.domain, gestores: d.gestores, metrics: byDom.get(d.id) ?? toMetrics() }));
      return { id: s.id, name: s.name, metrics: sum(doms.map((d) => d.metrics)), domains: doms };
    }),
  });
});
