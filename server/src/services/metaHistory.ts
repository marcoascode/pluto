/**
 * 0.18 · Etapa 2 — Analisador de histórico: sugere a configuração da próxima campanha Meta de um site a partir do que
 * as campanhas Meta anteriores desse site entregaram no Pluto.
 *
 * Reaproveita aggregate() (services/metrics.ts), então ROI, IVA, revShare do domínio e o escopo do gestor (RowFilter)
 * são exatamente os das telas de relatório — uma sugestão nunca usa dado que o usuário não enxerga.
 *
 * O que o histórico do Pluto realmente guarda (daily_metrics): gasto, receita, cliques e impressões por campanha × dia × país.
 * Objetivo, posicionamentos, idade/gênero e janela de atribuição NÃO são gravados pela sincronização; por isso esses
 * campos saem com basis:'default' (regra fixa, editável pelo usuário) e nunca fingem ser aprendidos do histórico.
 */
import { q } from '../db.js';
import type { RowFilter } from '../auth/scope.js';
import { addDays, today } from '../lib/dates.js';
import { aggregate, type Metrics } from './metrics.js';
import * as fx from './fx.js';

export type Basis = 'history' | 'default';

export interface CampaignSuggestion {
  site: string;
  window: { from: string; to: string; days: number };
  /** high: 5+ campanhas com gasto relevante e 14+ dias · medium: 2+ campanhas · low: pouco histórico · none: sem histórico Meta. */
  confidence: 'high' | 'medium' | 'low' | 'none';
  objective: { value: 'OUTCOME_TRAFFIC'; optimizationGoal: 'LANDING_PAGE_VIEWS'; basis: Basis; note: string };
  dailyBudget: { usd: number | null; brl: number | null; rangeUsd: [number, number] | null; basis: Basis; note: string };
  audience: {
    countries: { code: string; spendUsd: number; revenueUsd: number; roi: number | null }[];
    avoidCountries: { code: string; spendUsd: number; roi: number | null }[];
    ageMin: number; ageMax: number; genders: 'all'; basis: Basis; note: string;
  };
  placements: { mode: 'automatic'; basis: 'default'; note: string };
  attribution: { clickDays: 1 | 7; viewDays: 0; basis: 'default'; note: string };
  evidence: { campaignId: string; name: string; spendUsd: number; revenueUsd: number; roi: number | null; avgDailySpendUsd: number | null }[];
  warnings: string[];
}

const MIN_SPEND_USD = 5;      // gasto mínimo (campanha ou país) para entrar na análise
const n = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? 0 : v);
const r2 = (v: number) => Math.round(v * 100) / 100;
function quantile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export async function suggestCampaign(o: { domainId: string; hostname: string; filter: RowFilter | null; days: number }): Promise<CampaignSuggestion> {
  const to = today(), from = addDays(to, -(o.days - 1));
  const base = { from, to, domainIds: [o.domainId], filter: o.filter, where: `m.platform = 'meta' AND m.campaign_id IS NOT NULL` };
  // 0.18.6: o custo vem em BRL; a sugestão trabalha em USD (orçamento e faixas), então converte o gasto pela cotação atual.
  // ROI % e lucro (sinal) continuam os do relatório.
  const brlRate = (await fx.latest().catch(() => null))?.rates.BRL ?? null;
  const toUsd = (mp: Map<string, Metrics>) => new Map([...mp].map(([k, m]) => [k, { ...m, spend: brlRate ? m.spend / Number(brlRate) : m.spend }]));
  const [byCampaign, byCountry, byCampaignDay] = (await Promise.all([
    aggregate({ ...base, groupBy: 'm.campaign_id' }),
    aggregate({ ...base, groupBy: 'm.country' }),
    aggregate({ ...base, groupBy: `(m.campaign_id::text || '|' || m.date::text)` }),
  ])).map(toUsd);

  const warnings: string[] = [];
  const camps = [...byCampaign.entries()].map(([id, m]) => ({ id, m })).filter((c) => n(c.m.spend) >= MIN_SPEND_USD);
  const names = camps.length ? new Map((await q<{ id: string; name: string }>('SELECT id::text, name FROM campaigns WHERE id = ANY($1::bigint[])', [camps.map((c) => c.id)])).map((r) => [r.id, r.name])) : new Map<string, string>();

  // vencedoras: lucrativas (receita líquida > gasto com IVA). Sem nenhuma, usa as 3 de melhor ROI e avisa.
  const byRoi = [...camps].sort((a, b) => n(b.m.roi) - n(a.m.roi));
  let winners = byRoi.filter((c) => n(c.m.profit) > 0).slice(0, 5);
  if (!winners.length && byRoi.length) { winners = byRoi.slice(0, 3); warnings.push('Nenhuma campanha Meta deste site fechou no lucro no período; a sugestão usa as 3 de menor prejuízo. Comece com orçamento baixo.'); }

  const dailySpend = (id: string) => [...byCampaignDay.entries()].filter(([k]) => k.startsWith(`${id}|`)).map(([, m]) => n(m.spend)).filter((v) => v > 0);
  const evidence = winners.map((c) => {
    const d = dailySpend(c.id);
    return { campaignId: c.id, name: names.get(c.id) ?? `Campanha ${c.id}`, spendUsd: r2(n(c.m.spend)), revenueUsd: r2(n(c.m.revenue)), roi: c.m.roi == null ? null : r2(c.m.roi), avgDailySpendUsd: d.length ? r2(d.reduce((a, b) => a + b, 0) / d.length) : null };
  });

  const distinctDays = new Set([...byCampaignDay.keys()].map((k) => k.split('|')[1])).size;
  const confidence: CampaignSuggestion['confidence'] = !camps.length ? 'none' : camps.length >= 5 && distinctDays >= 14 ? 'high' : camps.length >= 2 ? 'medium' : 'low';
  if (confidence === 'none') warnings.push(`Sem histórico de campanhas Meta com gasto ≥ US$ ${MIN_SPEND_USD} em ${o.hostname} nos últimos ${o.days} dias. Defina orçamento e público manualmente.`);
  else if (confidence === 'low') warnings.push('Histórico curto (1 campanha com gasto relevante): trate a sugestão como ponto de partida.');

  // orçamento diário: mediana do gasto diário das vencedoras (dias com gasto), faixa p25–p75
  const days = winners.flatMap((c) => dailySpend(c.id)).sort((a, b) => a - b);
  const med = days.length ? r2(quantile(days, 0.5)) : null;
  const dailyBudget = {
    usd: med, brl: med != null && brlRate ? r2(med * Number(brlRate)) : null,
    rangeUsd: days.length ? [r2(quantile(days, 0.25)), r2(quantile(days, 0.75))] as [number, number] : null,
    basis: (days.length ? 'history' : 'default') as Basis,
    note: days.length ? 'Mediana do gasto diário das campanhas vencedoras do site (sem IVA da Meta no valor).' : 'Sem histórico para calcular; defina manualmente.',
  };

  // países: lucrativos por lucro; "evitar" = gasto relevante com prejuízo
  const countries = [...byCountry.entries()].filter(([c, m]) => c !== 'ZZ' && n(m.spend) >= MIN_SPEND_USD);
  const good = countries.filter(([, m]) => n(m.profit) > 0).sort((a, b) => n(b[1].profit) - n(a[1].profit)).slice(0, 10);
  const bad = countries.filter(([, m]) => n(m.profit) < 0).sort((a, b) => n(a[1].profit) - n(b[1].profit)).slice(0, 10);
  const pick = (m: Metrics) => ({ spendUsd: r2(n(m.spend)), roi: m.roi == null ? null : r2(m.roi) });

  return {
    site: o.hostname,
    window: { from, to, days: o.days },
    confidence,
    objective: { value: 'OUTCOME_TRAFFIC', optimizationGoal: 'LANDING_PAGE_VIEWS', basis: 'default', note: 'A receita do Pluto vem de anúncios no site (sessões), então o padrão é tráfego otimizado para visualização da página de destino. O objetivo não é gravado no histórico.' },
    dailyBudget,
    audience: {
      countries: good.map(([code, m]) => ({ code, ...pick(m), revenueUsd: r2(n(m.revenue)) })),
      avoidCountries: bad.map(([code, m]) => ({ code, ...pick(m) })),
      ageMin: 18, ageMax: 65, genders: 'all', basis: good.length ? 'history' : 'default',
      note: good.length ? 'Países por lucro no histórico. Idade e gênero não são gravados no histórico: padrão 18–65, todos.' : 'Sem países lucrativos no histórico; escolha o público manualmente.',
    },
    placements: { mode: 'automatic', basis: 'default', note: 'A sincronização não grava posicionamento da Meta; padrão Advantage+ (automático).' },
    attribution: { clickDays: 1, viewDays: 0, basis: 'default', note: 'Janela padrão de 1 dia de clique; não é gravada no histórico.' },
    evidence,
    warnings,
  };
}
