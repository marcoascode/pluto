/**
 * Workers de sincronização. Cada job recebe a janela e grava em daily_metrics/campaigns/ad_groups/ads/urls.
 *
 * O que falta plugar (precisa das credenciais reais de cada API):
 *  - google-ads.*: Google Ads API (GAQL) com developer token + refresh token da MCC
 *      SELECT segments.date, campaign.id, ad_group.id, ad_group_ad.ad.id, segments.geo_target_country(*), metrics.cost_micros, metrics.clicks, metrics.impressions FROM ad_group_ad …
 *      (*) país via geographic_view / user_location_view
 *  - meta.*: Marketing API /act_{id}/insights?level=ad&breakdowns=country&time_increment=1&fields=spend,clicks,impressions
 *  - gam.*:  Ad Manager API v1 (REST) networks/{code}/reports — dimensões DATE, AD_UNIT, COUNTRY_CODE, CUSTOM_KEY_VALUES (utm_campaign/adgroup/creative), métricas
 *            AD_SERVER_IMPRESSIONS…/TOTAL_IMPRESSIONS, AD_REQUESTS, RESPONSES_SERVED, REVENUE, CLICKS, ACTIVE_VIEW_*
 * Regras: converter custo da moeda da conta para USD pela taxa do dia antes de gravar; receita sem key-values válidos → platform='none' + unattributed_reason.
 */
import { one, q, tx } from '../../db.js';
import { addDays, today } from '../../lib/dates.js';
import { refreshRates } from '../fx.js';

export type JobResult = { status: 'success' | 'skipped' | 'failed'; message?: string };
type Runner = (window: { from: string; to: string }) => Promise<JobResult>;

async function connected(provider: string) {
  const c = await one<{ status: string; has: boolean }>('SELECT status, refresh_token_enc IS NOT NULL OR access_token_enc IS NOT NULL AS has FROM integration_connections WHERE provider = $1', [provider]);
  return !!c?.has;
}
const notConnected = (p: string): JobResult => ({ status: 'skipped', message: `${p} ainda não conectado via OAuth` });
const todo = (p: string): JobResult => ({ status: 'skipped', message: `worker de ${p} ainda não implementado (ver services/sync/index.ts)` });

const RUNNERS: Record<string, Runner> = {
  'fx.rates': async () => { const r = await refreshRates(); return { status: 'success', message: `${r.count} taxas · ${r.source}` }; },
  'google-ads.metrics': async () => ((await connected('google-ads')) ? todo('Google Ads') : notConnected('Google Ads')),
  'google-ads.structure': async () => ((await connected('google-ads')) ? todo('Google Ads') : notConnected('Google Ads')),
  'meta.metrics': async () => ((await connected('meta')) ? todo('Meta') : notConnected('Meta')),
  'meta.structure': async () => ((await connected('meta')) ? todo('Meta') : notConnected('Meta')),
  // 'gam.revenue': async () => ((await connected('gam')) ? todo('Ad Manager') : notConnected('Ad Manager')),
  // 'gam.close': async () => ((await connected('gam')) ? todo('Ad Manager') : notConnected('Ad Manager')),
  'gam.revenue': async (w) => ((await connected('gam')) ? syncGam(w, false) : notConnected('Ad Manager')),
  'gam.close': async (w) => ((await connected('gam')) ? syncGam(w, true) : notConnected('Ad Manager')),
};

// Função placeholder para descriptografar ou gerar novo Access Token via Refresh Token.
// Substitua pela sua implementação existente de OAuth no backend.
async function getAccessToken(provider: string): Promise<string> {
  const c = await one<{ access_token: string }>('SELECT access_token_enc AS access_token FROM integration_connections WHERE provider = $1', [provider]);
  if (!c?.access_token) throw new Error(`Sem token ativo para ${provider}`);
  // Implementar aqui sua lógica de descriptografia (se necessário) e de verificação de expiração.
  return c.access_token;
}

// Helper para converter o arquivo de resposta do GAM num Array iterável
function parseGamReport(csvStr: string) {
  const lines = csvStr.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',');
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => obj[h] = vals[idx]);
    result.push(obj);
  }
  return result;
}

async function syncGam(window: { from: string; to: string }, isClose: boolean): Promise<JobResult> {
  try {
    const token = await getAccessToken('gam');
    
    // 1. Obter informações vitais da rede GAM no banco
    const conn = await one<{ network_code: string; currency: string }>(
      `SELECT metadata->>'network_code' AS network_code, metadata->>'currency' AS currency FROM integration_connections WHERE provider = 'gam'`
    );
    if (!conn) return { status: 'failed', message: 'Configurações de GAM (network_code) não encontradas' };

    const { network_code, currency = 'USD' } = conn;

    // 2. Extrair e preparar datas no formato suportado pela API
    const [fYear, fMonth, fDay] = window.from.split('-');
    const [tYear, tMonth, tDay] = window.to.split('-');

    const reportBody = {
      reportDefinition: {
        dimensions: ["DATE", "AD_UNIT_NAME", "COUNTRY_CODE", "CUSTOM_KEY_VALUES"],
        metrics: [
          "TOTAL_IMPRESSIONS", 
          "AD_REQUESTS", 
          "RESPONSES_SERVED", 
          "REVENUE", 
          "CLICKS", 
          "ACTIVE_VIEW_VIEWABLE_IMPRESSIONS"
        ],
        dateRange: {
          customDateRange: {
            startDate: { year: Number(fYear), month: Number(fMonth), day: Number(fDay) },
            endDate: { year: Number(tYear), month: Number(tMonth), day: Number(tDay) }
          }
        }
      }
    };

    // 3. Iniciar o Job de Relatório
    const runRes = await fetch(`https://admanager.googleapis.com/v1/networks/${network_code}/reports:run`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(reportBody)
    });

    if (!runRes.ok) throw new Error(`Falha ao iniciar relatório GAM: ${await runRes.text()}`);
    const operation = await runRes.json(); // Retorna o nome da operação (LRO)
    
    // 4. Efetuar polling até a conclusão da extração do relatório
    let reportUrl = '';
    while (true) {
      const pollRes = await fetch(`https://admanager.googleapis.com/v1/${operation.name}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const pollData = await pollRes.json();
      
      if (pollData.done) {
        if (pollData.error) throw new Error(`Erro na API do GAM: ${pollData.error.message}`);
        
        // Puxar a URL de download gerada
        const resultRes = await fetch(`https://admanager.googleapis.com/v1/${operation.name}:download`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const resultData = await resultRes.json();
        reportUrl = resultData.downloadUrl;
        break;
      }
      await new Promise(r => setTimeout(r, 5000)); // Espera 5s entre checagens
    }

    // 5. Baixar dados e buscar histórico de taxas (FX) do mesmo período para conversão
    const rawData = await (await fetch(reportUrl)).text();
    const rows = parseGamReport(rawData);
    
    const ratesRows = await q<{ date: string; rate: number }>(
      `SELECT date::text, rate_per_usd AS rate FROM currency_rates WHERE currency = $1 AND date BETWEEN $2 AND $3`,
      [currency, window.from, window.to]
    );
    const fx = Object.fromEntries(ratesRows.map(r => [r.date, r.rate]));

    // 6. Percorrer o relatório e gravar num batch no DB (Transacional)
    let processedRows = 0;
    await tx(async (c) => {
      for (const row of rows) {
        const date = row['Dimension.DATE'];
        const customValues = row['Dimension.CUSTOM_KEY_VALUES'] || '';
        
        let platform = 'none';
        let unattributedReason = 'missing_platform';

        // Regra de parseamento dos custom key-values configurados no Ad Manager
        if (customValues.includes('platform=')) {
           const match = customValues.match(/platform=([^;]+)/);
           if (match) {
             platform = match[1].toLowerCase();
             unattributedReason = '';
           }
        }

        // Lógica de moeda: Dividir os Micros da API por 1000000 e multiplicar pela taxa (para USD) do respectivo dia
        const rate = fx[date] || 1; 
        const revenueLocal = Number(row['Column.REVENUE'] || 0) / 1000000;
        const revenueUsd = revenueLocal * rate;

        const impressions = Number(row['Column.TOTAL_IMPRESSIONS'] || 0);
        const adRequests = Number(row['Column.AD_REQUESTS'] || 0);
        const responses = Number(row['Column.RESPONSES_SERVED'] || 0);
        const clicks = Number(row['Column.CLICKS'] || 0);
        const viewable = Number(row['Column.ACTIVE_VIEW_VIEWABLE_IMPRESSIONS'] || 0);
        
        // Mapeamento dinâmico de Domínio via bloco de anúncios ou valor nativo (adapte a regra à sua necessidade de domain_id)
        const domainId = 1; // Substitua por lógica que busque o domain_id baseado no 'Dimension.AD_UNIT_NAME' ou metadados associados.

        // Inserção com base UPSERT (Upsert soma se encontrar chave duplicada/existente, atualiza com EXCLUDED)
        await c.query(`
          INSERT INTO daily_metrics (
            date, domain_id, platform, revenue_usd, gross_revenue_usd, impressions, 
            ad_requests, responses_served, ad_clicks, viewable, unattributed_reason
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (date, domain_id, platform, campaign_id, ad_group_id, ad_id) 
          DO UPDATE SET 
            revenue_usd = daily_metrics.revenue_usd + EXCLUDED.revenue_usd,
            gross_revenue_usd = daily_metrics.gross_revenue_usd + EXCLUDED.gross_revenue_usd,
            impressions = daily_metrics.impressions + EXCLUDED.impressions,
            ad_requests = daily_metrics.ad_requests + EXCLUDED.ad_requests,
            responses_served = daily_metrics.responses_served + EXCLUDED.responses_served,
            ad_clicks = daily_metrics.ad_clicks + EXCLUDED.ad_clicks,
            viewable = daily_metrics.viewable + EXCLUDED.viewable
        `, [
          date, domainId, platform, revenueUsd, revenueUsd, impressions, adRequests, 
          responses, clicks, viewable, unattributedReason
        ]);
        
        processedRows++;
      }
    });

    return { status: 'success', message: `${processedRows} registros de receita (GAM) sincronizados.` };
  } catch (error) {
    return { status: 'failed', message: (error as Error).message.slice(0, 500) };
  }
}

/** Janela de cada job: incremental D-3 → hoje; fechamento D-7 → D-4. */
function windowFor(id: string) {
  const t = today();
  if (id === 'gam.close') return { from: addDays(t, -7), to: addDays(t, -4) };
  return { from: addDays(t, -3), to: t };
}

/** Executa um job agora, registrando em sync_jobs e atualizando sync_settings. */
export async function runJob(settingId: string): Promise<JobResult> {
  const runner = RUNNERS[settingId];
  if (!runner) return { status: 'failed', message: 'job desconhecido' };
  const w = windowFor(settingId);
  const job = await one<{ id: string }>(`INSERT INTO sync_jobs (setting_id, provider, window_from, window_to, status, attempts) VALUES ($1, split_part($1, '.', 1), $2, $3, 'running', 1) RETURNING id::text`, [settingId, w.from, w.to]);
  await q(`UPDATE sync_settings SET last_status = 'running' WHERE id = $1`, [settingId]);
  let res: JobResult;
  try { res = await runner(w); } catch (e) { res = { status: 'failed', message: (e as Error).message.slice(0, 500) }; }
  await q(`UPDATE sync_jobs SET status = $2, message = $3, finished_at = now() WHERE id = $1`, [job!.id, res.status, res.message ?? null]);
  await q(`UPDATE sync_settings SET last_run_at = now(), next_run_at = now() + make_interval(mins => every_minutes), last_status = $2 WHERE id = $1`,
    [settingId, res.status === 'failed' ? 'failed' : 'success']);
  if (res.status === 'success' && !settingId.startsWith('fx')) await q(`UPDATE integration_connections SET last_sync_at = now() WHERE provider = split_part($1, '.', 1)`, [settingId]);
  return res;
}

/** Roda os jobs de um provedor (botão "Sincronizar agora"). */
export async function runProvider(provider: string) {
  const ids = await q<{ id: string }>('SELECT id FROM sync_settings WHERE provider = $1 AND enabled ORDER BY id', [provider]);
  for (const { id } of ids) await runJob(id);
}
