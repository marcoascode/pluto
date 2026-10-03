/** Todos os hooks de dados. Cada tela usa só estes, nunca fetch direto. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { meApi, searchApi, adminApi, attributionApi, campaignsApi, dashboardApi, domainsApi, fxApi, gamApi, integrationsApi, reportsApi, urlsApi } from '@/lib/api/endpoints';
import { qk } from '@/lib/api/keys';
import { useFilters } from '@/context/FiltersContext';
import type { Platform, Provider } from '@/types/api';

const opts = { placeholderData: keepPreviousData, staleTime: 60_000 } as const;

export function useMyDomains() { return useQuery({ queryKey: qk.myDomains, queryFn: meApi.domains, staleTime: 5 * 60_000 }); }
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
export function useUrls(domain: string) { const { query } = useFilters(); const q = { ...query, domain: domain || undefined }; return useQuery({ queryKey: qk.urls(q), queryFn: () => urlsApi.list(q), ...opts }); }
export function useGam() { const { query } = useFilters(); return useQuery({ queryKey: qk.gam(query), queryFn: () => gamApi.summary(query), ...opts }); }
/** Relatórios usam só Domínio e Moeda do topo (o mês é escolhido na própria tela). */
function useReportQuery() { const { domain, currency } = useFilters(); return { domain: domain || undefined, currency }; }
export function useDailyReport(month: string) { const q = useReportQuery(); return useQuery({ queryKey: qk.reportDaily(month, q), queryFn: () => reportsApi.daily({ ...q, month }), ...opts }); }
export function useMonthlyReport(months: number) { const q = useReportQuery(); return useQuery({ queryKey: qk.reportMonthly(months, q), queryFn: () => reportsApi.monthly({ ...q, months }), ...opts }); }
export function useHealth() { const { query } = useFilters(); return useQuery({ queryKey: qk.health(query), queryFn: () => attributionApi.health(query), ...opts }); }
export function useUtmTemplates() { return useQuery({ queryKey: qk.utmTemplates, queryFn: attributionApi.templates, staleTime: Infinity }); }
export function useUtmDebug() { return useMutation({ mutationFn: attributionApi.debug }); }
export function useFx() { return useQuery({ queryKey: qk.fx, queryFn: fxApi.latest, staleTime: 10 * 60_000 }); }
export function useFxHistory() { return useQuery({ queryKey: qk.fxHistory, queryFn: () => fxApi.history(10) }); }

/* ---- admin ---- */
export function useIntegrations() { return useQuery({ queryKey: qk.integrations, queryFn: integrationsApi.status }); }
export function useAdminDomains() { return useQuery({ queryKey: qk.adminDomains, queryFn: adminApi.domains }); }
export function useSquads() { return useQuery({ queryKey: qk.squads, queryFn: adminApi.squads }); }
export function useUsers() { return useQuery({ queryKey: qk.users, queryFn: adminApi.users }); }
export function usePermissions() { return useQuery({ queryKey: qk.permissions, queryFn: adminApi.permissions }); }
export function useIntegrationAccounts(p: Provider) { return useQuery({ queryKey: qk.accounts(p), queryFn: () => integrationsApi.accounts(p) }); }
export function useSyncSettings() { return useQuery({ queryKey: qk.syncSettings, queryFn: integrationsApi.syncSettings }); }
export function useAdminMutation<A, R>(fn: (a: A) => Promise<R>, invalidate: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k as unknown[] })) });
}
