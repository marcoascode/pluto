/**
 * Google Ad Manager (Ad Manager API v1, REST).
 * Relatório HISTORICAL em USD: DATE × SITE × COUNTRY_CODE × key-values (dimensões personalizadas)
 *   métricas REVENUE, IMPRESSIONS, AD_REQUESTS, RESPONSES_SERVED, CLICKS, ACTIVE_VIEW_VIEWABLE_IMPRESSIONS.
 * Atribuição: o site manda no GPT os key-values utm_campaign ({campaignid} / {{campaign.id}}) e
 * utm_content ({adgroupid}_{creative} / {{adset.id}}_{{ad.id}}). Linha sem key-value válido → receita
 * "não atribuída" (platform = 'none' + motivo), nunca rateada entre campanhas.
 * Receita gravada BRUTA; o revShare do domínio é aplicado na consulta.
 */
import { config } from '../../config.js';
// import { one, q } from '../../db.js';
import { q } from '../../db.js';
import { domainResolver, emptyFact, replaceFacts, setAccountStatus, statusFromError, urlCache, type Fact } from './common.js';
import { requestJson, sleep, SyncError } from './http.js';
import { googleAccessToken } from './tokens.js';
import type { JobResult } from './index.js';

export type Val = { intValue?: string; doubleValue?: number; stringValue?: string; boolValue?: boolean };
export const num = (v?: Val) => (v ? Number(v.doubleValue ?? v.intValue ?? 0) || 0 : 0);
export const str = (v?: Val) => (v?.stringValue ?? (v?.intValue != null ? String(v.intValue) : '')).trim();
/** DATE vem como "2026-10-04", 20261004 ou "20261004". */
export function isoDate(v?: Val): string | null {
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}
export const date = (iso: string) => { const [year, month, day] = iso.split('-').map(Number); return { year, month, day }; };
export const EMPTY = /^(\(?not set\)?|\(?none\)?|-|n\/a|unknown|\(not applicable\))?$/i;

export interface KeyInfo { role: 'campaign' | 'content' | 'source' | 'path' | 'placement'; adTagName: string; id: string | null; usable: boolean }

/** Procura os ids dos key-values pelo nome usado na tag (adTagName). Só servem se estiverem como "Custom dimension". */
export async function resolveKeys(network: string, token: string, wanted: [KeyInfo['role'], string][] = Object.entries(config.gamKeys).filter(([, v]) => v) as [KeyInfo['role'], string][]): Promise<KeyInfo[]> {
  const out: KeyInfo[] = [];
  for (const [role, name] of wanted) {
    const u = `${config.api.gam}/v1/networks/${network}/customTargetingKeys?${new URLSearchParams({ filter: `adTagName = "${name}"`, pageSize: '5' })}`;
    const j = await requestJson<{ customTargetingKeys?: { customTargetingKeyId?: string; name?: string; adTagName?: string; reportableType?: string }[] }>(u, { headers: { Authorization: `Bearer ${token}` } });
    const k = j.customTargetingKeys?.find((x) => x.adTagName === name) ?? j.customTargetingKeys?.[0];
    const id = k?.customTargetingKeyId ?? k?.name?.split('/').pop() ?? null;
    out.push({ role, adTagName: name, id, usable: !!id && k?.reportableType === 'CUSTOM_DIMENSION' });
  }
  return out;
}

/** Cria o relatório (oculto), roda, espera e baixa todas as linhas. */
export async function runReport(network: string, token: string, from: string, to: string, keys: KeyInfo[], label = 'pluto-sync') {
  const auth = { Authorization: `Bearer ${token}` };
  const dims = ['DATE', 'SITE', 'COUNTRY_CODE', ...keys.map((_, i) => `CUSTOM_DIMENSION_${i}_VALUE`)];
  const metrics = ['REVENUE', 'IMPRESSIONS', 'AD_REQUESTS', 'RESPONSES_SERVED', 'CLICKS', 'ACTIVE_VIEW_VIEWABLE_IMPRESSIONS'];
  const report = await requestJson<{ name: string }>(`${config.api.gam}/v1/networks/${network}/reports`, {
    method: 'POST', headers: auth,
    body: {
      displayName: `${label} ${from}..${to} ${new Date().toISOString()}`,
      visibility: 'HIDDEN',
      reportDefinition: {
        dimensions: dims, metrics, reportType: 'HISTORICAL', currencyCode: 'USD',
        dateRange: { fixed: { startDate: date(from), endDate: date(to) } },
        ...(keys.length ? { customDimensionKeyIds: keys.map((k) => k.id) } : {}),
      },
    },
  });
  const op = await requestJson<{ name: string }>(`${config.api.gam}/v1/${report.name}:run`, { method: 'POST', headers: auth, body: {} });
  // espera: 5 s e vai aumentando (máx. ~10 min)
  let result: string | null = null;
  for (let i = 0, wait = 5_000; i < 40; i++, wait = Math.min(wait * 1.5, 30_000)) {
    const o = await requestJson<{ done?: boolean; error?: { message?: string }; response?: { reportResult?: string } }>(`${config.api.gam}/v1/${op.name}`, { headers: auth });
    if (o.error) throw new SyncError('api', `Relatório do Ad Manager falhou: ${o.error.message}`);
    if (o.done) { result = o.response?.reportResult ?? null; break; }
    await sleep(wait);
  }
  if (!result) throw new SyncError('api', 'O relatório do Ad Manager demorou demais. Nova tentativa no próximo ciclo.');
  const rows: { dimensionValues: Val[]; metricValueGroups: { primaryValues: Val[] }[] }[] = [];
  let pageToken: string | undefined;
  do {
    const j = await requestJson<{ rows?: typeof rows; nextPageToken?: string }>(`${config.api.gam}/v1/${result}:fetchRows?${new URLSearchParams({ pageSize: '10000', ...(pageToken ? { pageToken } : {}) })}`, { headers: auth, timeoutMs: 120_000 });
    rows.push(...(j.rows ?? []));
    pageToken = j.nextPageToken || undefined;
  } while (pageToken);
  return { rows, dims };
}

/** Índices de campanha/grupo/anúncio por id externo (Google e Meta). */
async function attributionIndex() {
  const camps = await q<{ id: string; ext: string; platform: 'google' | 'meta'; domain_id: string | null }>('SELECT id::text, external_id AS ext, platform, domain_id::text FROM campaigns');
  const groups = await q<{ id: string; ext: string; cid: string }>('SELECT id::text, external_id AS ext, campaign_id::text AS cid FROM ad_groups');
  const ads = await q<{ id: string; ext: string; gid: string }>('SELECT id::text, external_id AS ext, ad_group_id::text AS gid FROM ads');
  return {
    camp: new Map(camps.map((c) => [c.ext, c])),
    group: new Map(groups.map((g) => [`${g.cid}|${g.ext}`, g.id])),
    ad: new Map(ads.map((a) => [`${a.gid}|${a.ext}`, a.id])),
  };
}

// export async function runGam(w: { from: string; to: string }, isFinal = false): Promise<JobResult> {
//   const net = await one<{ id: string; external_id: string; name: string }>(`SELECT id::text, external_id, name FROM integration_accounts WHERE provider = 'gam' AND imported ORDER BY id LIMIT 1`);
//   if (!net) return { status: 'skipped', message: 'nenhuma rede do Ad Manager marcada para importar' };
//   try {
//     const token = await googleAccessToken('gam');
//     const all = await resolveKeys(net.external_id, token);
//     const keys = all.filter((k) => k.usable);
//     const missing = all.filter((k) => !k.usable && (k.role === 'campaign' || k.role === 'content'));   // source e path são opcionais
//     const { rows } = await runReport(net.external_id, token, w.from, w.to, keys);
//     const idx = await attributionIndex();
//     const dom = await domainResolver();
//     const url = urlCache();
//     const ki = (role: KeyInfo['role']) => { const i = keys.findIndex((k) => k.role === role); return i < 0 ? -1 : 3 + i; };
//     const iCamp = ki('campaign'), iContent = ki('content'), iSource = ki('source'), iPath = ki('path');
//     const facts: Fact[] = [];
//     let skipped = 0;
//     for (const r of rows) {
//       const d = r.dimensionValues;
//       const day = isoDate(d[0]);
//       const site = str(d[1]);
//       const m = r.metricValueGroups?.[0]?.primaryValues ?? [];
//       const revenue = num(m[0]);
//       if (!day || (!revenue && !num(m[1]) && !num(m[2]))) continue;
//       const domain = site && !EMPTY.test(site) ? await dom.ensure(site) : null;
//       if (!domain) { skipped++; continue; }
//       const campVal = iCamp >= 0 ? str(d[iCamp]) : '';
//       const content = iContent >= 0 ? str(d[iContent]) : '';
//       const source = iSource >= 0 ? str(d[iSource]).toLowerCase() : '';
//       // ---- atribuição ----
//       let platform: 'google' | 'meta' | 'none' = 'none', reason: string | null = null;
//       let campaignId: string | null = null, adGroupId: string | null = null, adId: string | null = null;
//       if (iCamp < 0) reason = 'gam_kv_not_configured';
//       else if (domain.pending) reason = 'unknown_domain';
//       else if (EMPTY.test(campVal)) reason = 'missing_campaign_id';
//       else if (/[{}]/.test(campVal) || /[{}]/.test(content)) reason = 'invalid_utm';
//       else {
//         const c = idx.camp.get(campVal);
//         if (!c) reason = source && /^(fb|facebook|ig|instagram|an|msg|meta)$/.test(source) ? 'meta_ad_not_found' : 'campaign_not_found';
//         else {
//           platform = c.platform; campaignId = c.id;
//           const [g, a] = content.split('_');
//           if (g && !EMPTY.test(g)) adGroupId = idx.group.get(`${c.id}|${g}`) ?? null;
//           if (adGroupId && a && !EMPTY.test(a)) adId = idx.ad.get(`${adGroupId}|${a}`) ?? null;
//         }
//       }
//       const path = iPath >= 0 ? str(d[iPath]) : '';
//       facts.push(emptyFact({
//         date: day, domainId: domain.id, urlId: path && !EMPTY.test(path) ? await url(domain.id, path) : null,
//         platform, campaignId, adGroupId, adId, country: str(d[2]).toUpperCase() || 'ZZ', reason,
//         revenueUsd: revenue, impressions: num(m[1]), adRequests: num(m[2]), responsesServed: num(m[3]), adClicks: num(m[4]), viewable: num(m[5]),
//       }));
//     }
//     const n = await replaceFacts('gam', w.from, w.to, 'all', facts, isFinal);
//     const warn = [
//       missing.length ? `key-values sem dimensão personalizada no Ad Manager: ${missing.map((k) => k.adTagName).join(', ')} (Admin → Key-values → "Report on values": Custom dimension)` : '',
//       skipped ? `${skipped} linhas sem site` : '',
//     ].filter(Boolean).join(' · ');
//     await setAccountStatus(net.id, 'ok', warn || null);
//     return { status: 'success', message: `${rows.length} linhas do relatório · ${n} gravadas${warn ? ' · ' + warn : ''}`.slice(0, 500) };
//   } catch (e) {
//     await setAccountStatus(net.id, statusFromError(e), (e as Error).message.slice(0, 300));
//     if (e instanceof SyncError && (e.code === 'not_connected' || e.code === 'not_configured')) return { status: 'skipped', message: e.message };
//     return { status: 'failed', message: (e as Error).message.slice(0, 500) };
//   }
// }

export async function runGam(w: { from: string; to: string }, isFinal = false): Promise<JobResult> {
  // 1. CORREÇÃO: Usa 'q' para buscar TODAS as redes marcadas para importar (sem LIMIT 1)
  const nets = await q<{ id: string; external_id: string; name: string }>(
    `SELECT id::text, external_id, name FROM integration_accounts WHERE provider = 'gam' AND imported ORDER BY id`
  );
  
  if (!nets || nets.length === 0) return { status: 'skipped', message: 'nenhuma rede do Ad Manager marcada para importar' };

  try {
    // 2. CORREÇÃO: Resolvemos os utilitários comuns fora do loop para não sobrecarregar o banco
    const token = await googleAccessToken('gam');
    const idx = await attributionIndex();
    const dom = await domainResolver();
    const url = urlCache();
    
    // Arrays acumuladores para salvar os dados de todas as contas em lote no final
    const allFacts: Fact[] = [];
    const messages: string[] = [];
    
    let totalRows = 0;
    let totalSkipped = 0;
    let hasErrors = false;

    // 3. CORREÇÃO: Loop iterando conta por conta
    for (const net of nets) {
      try {
        const all = await resolveKeys(net.external_id, token);
        const keys = all.filter((k) => k.usable);
        const missing = all.filter((k) => !k.usable && (k.role === 'campaign' || k.role === 'content'));
        
        const { rows } = await runReport(net.external_id, token, w.from, w.to, keys);
        totalRows += rows.length;

        const ki = (role: KeyInfo['role']) => { const i = keys.findIndex((k) => k.role === role); return i < 0 ? -1 : 3 + i; };
        const iCamp = ki('campaign'), iContent = ki('content'), iSource = ki('source'), iPath = ki('path');
        
        let skipped = 0;
        for (const r of rows) {
          const d = r.dimensionValues;
          const day = isoDate(d[0]);
          const site = str(d[1]);
          const m = r.metricValueGroups?.[0]?.primaryValues ?? [];
          const revenue = num(m[0]);
          
          if (!day || (!revenue && !num(m[1]) && !num(m[2]))) continue;
          
          const domain = site && !EMPTY.test(site) ? await dom.ensure(site) : null;
          if (!domain) { skipped++; totalSkipped++; continue; }
          
          const campVal = iCamp >= 0 ? str(d[iCamp]) : '';
          const content = iContent >= 0 ? str(d[iContent]) : '';
          const source = iSource >= 0 ? str(d[iSource]).toLowerCase() : '';
          
          // ---- atribuição ----
          let platform: 'google' | 'meta' | 'none' = 'none', reason: string | null = null;
          let campaignId: string | null = null, adGroupId: string | null = null, adId: string | null = null;
          
          if (iCamp < 0) reason = 'gam_kv_not_configured';
          else if (domain.pending) reason = 'unknown_domain';
          else if (EMPTY.test(campVal)) reason = 'missing_campaign_id';
          else if (/[{}]/.test(campVal) || /[{}]/.test(content)) reason = 'invalid_utm';
          else {
            const c = idx.camp.get(campVal);
            if (!c) reason = source && /^(fb|facebook|ig|instagram|an|msg|meta)$/.test(source) ? 'meta_ad_not_found' : 'campaign_not_found';
            else {
              platform = c.platform; campaignId = c.id;
              const [g, a] = content.split('_');
              if (g && !EMPTY.test(g)) adGroupId = idx.group.get(`${c.id}|${g}`) ?? null;
              if (adGroupId && a && !EMPTY.test(a)) adId = idx.ad.get(`${adGroupId}|${a}`) ?? null;
            }
          }
          const path = iPath >= 0 ? str(d[iPath]) : '';
          
          // Guarda o fact no array master da execução
          allFacts.push(emptyFact({
            date: day, domainId: domain.id, urlId: path && !EMPTY.test(path) ? await url(domain.id, path) : null,
            platform, campaignId, adGroupId, adId, country: str(d[2]).toUpperCase() || 'ZZ', reason,
            revenueUsd: revenue, impressions: num(m[1]), adRequests: num(m[2]), responsesServed: num(m[3]), adClicks: num(m[4]), viewable: num(m[5]),
          }));
        }
        
        const warn = [
          missing.length ? `sem KVs: ${missing.map((k) => k.adTagName).join(', ')}` : '',
          skipped ? `${skipped} s/ site` : '',
        ].filter(Boolean).join(' · ');
        
        // Sucesso nesta conta! Grava o status isolado dela
        await setAccountStatus(net.id, 'ok', warn || null);
        messages.push(`[${net.name}] ok${warn ? ' (' + warn + ')' : ''}`);
        
      } catch (e) {
        // 4. CORREÇÃO: O Try/Catch interno segura o erro e deixa o loop avançar para a próxima conta
        hasErrors = true;
        await setAccountStatus(net.id, statusFromError(e), (e as Error).message.slice(0, 300));
        
        // Log customizado na string final
        if (e instanceof SyncError && (e.code === 'not_connected' || e.code === 'not_configured')) {
           messages.push(`[${net.name}] pulada`);
        } else {
           messages.push(`[${net.name}] falhou`);
        }
      }
    } // -- Fim do loop de contas

    // 5. Salva todas as linhas de todas as contas processadas de uma só vez (Performance otimizada)
    let n = 0;
    if (allFacts.length > 0) {
       n = await replaceFacts('gam', w.from, w.to, 'all', allFacts, isFinal);
    }

    const warnGlobal = totalSkipped ? ` · ${totalSkipped} s/ site` : '';
    const summary = `${totalRows} linhas no total · ${n} gravadas · Contas: ${messages.join(' | ')}${warnGlobal}`;
    
    // Retorna falha geral apenas se NENHUMA conta conseguiu extrair dados
    return { 
        status: (hasErrors && allFacts.length === 0) ? 'failed' : 'success', 
        message: summary.slice(0, 500) 
    };
    
  } catch (e) {
    // Erro global grave (ex: queda do banco ao carregar chaves no início)
    return { status: 'failed', message: (e as Error).message.slice(0, 500) };
  }
}