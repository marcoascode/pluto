/** Todos os hooks de dados. Cada tela usa só estes, nunca fetch direto. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { metaCampaignsApi, meApi, searchApi, adminApi, companiesApi, attributionApi, campaignsApi, dashboardApi, domainsApi, financeApi, fxApi, gamApi, integrationsApi, placementsApi, reportsApi, urlsApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { useFilters } from '@/context/FiltersContext';
import type { Platform, PlacementQuery, Provider } from '@/types/api';

const opts = { placeholderData: keepPreviousData, staleTime: 60_000 } as const;

/** Domínios do usuário, já filtrados pela Empresa escolhida no topo. */
export function useMyDomains() { const { company } = useFilters(); return useQuery({ queryKey: qk.myDomains(company), queryFn: () => meApi.domains(company || undefined), staleTime: 5 * 60_000 }); }
export function useMyCompanies() { return useQuery({ queryKey: qk.myCompanies, queryFn: meApi.companies, staleTime: 5 * 60_000 }); }
export function useCompanyOverview(id: string) { const { query } = useFilters(); return useQuery({ queryKey: qk.companyOverview(id, query), queryFn: () => companiesApi.overview(id, query), ...opts }); }
export function useAdminCompanies() { return useQuery({ queryKey: qk.adminCompanies, queryFn: adminApi.companies }); }
export function useFxDiscount() { return useQuery({ queryKey: qk.fxDiscount, queryFn: adminApi.fxDiscount }); }
export function useSearch(q: string) { return useQuery({ queryKey: qk.search(q), queryFn: () => searchApi.search(q), enabled: q.trim().length >= 2, staleTime: 30_000 }); }
export function useDashboard() { const { query } = useFilters(); return useQuery({ queryKey: qk.dashboard(query), queryFn: () => dashboardApi.get(query), ...opts }); }
export function useDomainsSummary() { const { query } = useFilters(); return useQuery({ queryKey: qk.domains(query), queryFn: () => domainsApi.summary(query), ...opts }); }
export function useDomain(domain: string) { const { query } = useFilters(); const q = { ...query, domain: undefined }; return useQuery({ queryKey: qk.domain(domain, q), queryFn: () => domainsApi.detail(domain, q), ...opts }); }
export function useCampaigns(platform: Platform, extra: { accountId?: string; includePaused?: boolean }) {
  const { query } = useFilters();
  return useQuery({ queryKey: qk.campaigns(platform, query, extra), queryFn: () => campaignsApi.list({ ...query, platform, ...extra }), ...opts });
}
export function useCampaignChildren(platform: Platform, id: string, enabled: boolean) {
  const { query } = useFilters(); const q = { ...query, domain: undefined };
  return useQuery({ queryKey: qk.children(platform, id, q), queryFn: () => campaignsApi.children(platform, id, q), enabled, ...opts });
}
export function useCampaignCountries(platform: Platform, id: string | null) {
  const { query } = useFilters(); const q = { ...query, domain: undefined };
  return useQuery({ queryKey: qk.countries(platform, id ?? '', q), queryFn: () => campaignsApi.countries(platform, id!, q), enabled: !!id });
}
/** Placements: o domínio vem do filtro da própria tela (não do topo). sel = pesquisa aplicada; null = ainda não pesquisou. */
export interface PlacementSel { domain: string; accounts: string[]; campaigns: string[] }
function usePlacementQuery(sel: PlacementSel | null): PlacementQuery | null {
  const { from, to, currency, company } = useFilters();
  return sel ? { from, to, currency, company: company || undefined, domain: sel.domain, accounts: sel.accounts.join(',') || undefined, campaigns: sel.campaigns.join(',') || undefined } : null;
}
export function usePlacementFilters(domain: string) { return useQuery({ queryKey: qk.placementFilters(domain), queryFn: () => placementsApi.filters(domain), enabled: !!domain, staleTime: 5 * 60_000 }); }
export function usePlacements(sel: PlacementSel | null) {
  const q = usePlacementQuery(sel);
  return useQuery({ queryKey: qk.placements(q!), queryFn: () => placementsApi.list(q!), enabled: !!q, ...opts });
}
export function usePlacementCampaigns(sel: PlacementSel | null, placement: string | null, level: 'root' | 'host') {
  const q = usePlacementQuery(sel);
  return useQuery({ queryKey: qk.placementCampaigns(q!, placement ?? '', level), queryFn: () => placementsApi.campaigns({ ...q!, placement: placement!, level }), enabled: !!q && !!placement });
}
export function useUrls(domain: string, origin = '') { const { query } = useFilters(); const q = { ...query, domain: domain || undefined, origin: origin || undefined }; return useQuery({ queryKey: qk.urls(q), queryFn: () => urlsApi.list(q), ...opts }); }
export function useGam() { const { query } = useFilters(); return useQuery({ queryKey: qk.gam(query), queryFn: () => gamApi.summary(query), ...opts }); }
/** Relatórios usam só Domínio e Moeda do topo (o mês é escolhido na própria tela). */
function useReportQuery() { const { domain, currency, company } = useFilters(); return { domain: domain || undefined, currency, company: company || undefined }; }
export function useDailyReport(month: string) { const q = useReportQuery(); return useQuery({ queryKey: qk.reportDaily(month, q), queryFn: () => reportsApi.daily({ ...q, month }), ...opts }); }
export function useMonthlyReport(months: number) { const q = useReportQuery(); return useQuery({ queryKey: qk.reportMonthly(months, q), queryFn: () => reportsApi.monthly({ ...q, months }), ...opts }); }
export function useHealth() { const { query } = useFilters(); return useQuery({ queryKey: qk.health(query), queryFn: () => attributionApi.health(query), ...opts }); }
export function useUtmTemplates() { return useQuery({ queryKey: qk.utmTemplates, queryFn: attributionApi.templates, staleTime: Infinity }); }
export function useUtmDebug() { return useMutation({ mutationFn: attributionApi.debug }); }
export function useFx() { return useQuery({ queryKey: qk.fx, queryFn: fxApi.latest, staleTime: 10 * 60_000 }); }
export function useFxHistory() { return useQuery({ queryKey: qk.fxHistory, queryFn: () => fxApi.history(10) }); }

/* ---- admin ---- */
export function useIntegrations() { return useQuery({ queryKey: qk.integrations, queryFn: integrationsApi.status }); }
export function useAdminDomains(enabled = true) { return useQuery({ queryKey: qk.adminDomains, queryFn: adminApi.domains, enabled }); }
export function useMetaTagAudit(days = 7) { return useQuery({ queryKey: qk.metaTagAudit(days), queryFn: () => adminApi.metaTagAudit(days) }); }
export function useUnmappedCampaigns(p: Platform = 'meta', enabled = true) { return useQuery({ queryKey: qk.unmapped(p), queryFn: () => adminApi.unmappedCampaigns(p), enabled }); }
/** Define o domínio de uma campanha. Atualiza tudo que mostra custo por domínio/campanha. */
export function useSetCampaignDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminApi.setCampaignDomain,
    onSuccess: () => ['unmapped', 'campaigns', 'dashboard', 'domains', 'domain', 'children', 'reportDaily', 'reportMonthly', 'integrations', 'accounts', 'companyOverview']
      .forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
}
export function useSquads() { return useQuery({ queryKey: qk.squads, queryFn: adminApi.squads }); }
export function useUsers() { return useQuery({ queryKey: qk.users, queryFn: adminApi.users }); }
export function usePermissions() { return useQuery({ queryKey: qk.permissions, queryFn: adminApi.permissions }); }
export function useIntegrationAccounts(p: Provider) { return useQuery({ queryKey: qk.accounts(p), queryFn: () => integrationsApi.accounts(p) }); }
export function useSyncSettings() { return useQuery({ queryKey: qk.syncSettings, queryFn: integrationsApi.syncSettings }); }
export function useAdminMutation<A, R>(fn: (a: A) => Promise<R>, invalidate: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k as unknown[] })) });
}

/* ---- Finance ---- */
export function useFinanceOverview(from: string, to: string) {
  const { company, currency } = useFilters();
  const q = { company: company || undefined, from, to, currency };
  return useQuery({ queryKey: qk.finance(q), queryFn: () => financeApi.overview(q), ...opts });
}
export function useFinanceCosts(month: string) {
  const { company, currency } = useFilters();
  const q = { company: company || undefined, month, currency };
  return useQuery({ queryKey: qk.financeCosts(q), queryFn: () => financeApi.costs(q), ...opts });
}
/** Salvar/excluir custo ou lançamento de caixa atualiza as duas telas do Finance. */
export function useFinanceMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { qc.invalidateQueries({ queryKey: ['finance'] }); qc.invalidateQueries({ queryKey: ['financeCosts'] }); } });
}

/* ---- 0.18 · campanhas Meta automatizadas ---- */
export function useMetaProfiles() { return useQuery({ queryKey: qk.metaProfiles, queryFn: metaCampaignsApi.profiles }); }
export function useMetaAdAccounts(profileId: string) { return useQuery({ queryKey: qk.metaAdAccounts(profileId), queryFn: () => metaCampaignsApi.adAccounts(profileId), enabled: !!profileId, staleTime: 60_000, retry: false }); }
export function useMetaPages(profileId: string) { return useQuery({ queryKey: qk.metaPages(profileId), queryFn: () => metaCampaignsApi.pages(profileId), enabled: !!profileId, staleTime: 60_000, retry: false }); }
/** Pixels/Datasets sincronizados do Perfil utilizáveis na conta (BMs + pixels da conta), sem os indisponíveis. */
export function useMetaDatasets(profileId: string, adAccountId: string) {
  return useQuery({
    queryKey: qk.metaDatasets(profileId, adAccountId), enabled: !!profileId && !!adAccountId, staleTime: 60_000, retry: false,
    queryFn: async () => ({ datasets: (await metaCampaignsApi.datasets(profileId, adAccountId)).datasets.filter((d) => !d.unavailable) }),
  });
}
export function useMetaConversionEvents(profileId: string, adAccountId: string, datasetId: string) {
  return useQuery({ queryKey: qk.metaConversionEvents(profileId, adAccountId, datasetId), queryFn: () => metaCampaignsApi.conversionEvents(profileId, adAccountId, datasetId), enabled: !!profileId && !!adAccountId && !!datasetId, staleTime: 5 * 60_000, retry: false });
}
export function useMetaDrafts() { return useQuery({ queryKey: qk.metaDrafts, queryFn: metaCampaignsApi.drafts }); }
export function useMetaSuggestion(site: string, enabled: boolean) { return useQuery({ queryKey: qk.metaSuggestion(site), queryFn: () => metaCampaignsApi.suggestion(site), enabled: enabled && !!site, staleTime: 5 * 60_000, retry: false }); }
export function useMetaTrackedUrl(site: string, url: string) { return useQuery({ queryKey: qk.metaTrackedUrl(site, url), queryFn: () => metaCampaignsApi.trackedUrl(site, url), enabled: !!site && /^https:\/\/\S+\.\S+/i.test(url), staleTime: 60_000, retry: false }); }
