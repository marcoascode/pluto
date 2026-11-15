/**
 * 0.17 — Contas de anúncios × Sites (vínculo com data) e atribuição de domínios/contas aos gestores.
 * O servidor confere tudo de novo: o gestor só vê e só liga as contas e os domínios atribuídos a ele.
 */
import { api } from '@/lib/api/client';

export type LinkRole = 'gestor' | 'gerente' | 'admin' | 'superadmin';
export interface LinkDomain { id: string; hostname: string; active?: boolean }
export interface LinkPeriod { id: string; accountId: string; from: string; domains: string[]; by: string | null; at: string }
export interface LinkAccount {
  id: string; name: string; provider: 'google-ads' | 'meta'; externalId: string; imported: boolean; status: string | null;
  domains: (LinkDomain & { editable: boolean })[];
  /** desde quando vale o vínculo de hoje (null = desde sempre) */
  since: string | null;
  history: LinkPeriod[];
}
export interface LinksResponse { viewer: { role: LinkRole; canDate: boolean; canAssign: boolean; today: string }; domains: LinkDomain[]; accounts: LinkAccount[] }
export interface GestorAssign { id: string; name: string; email: string; domains: string[]; accounts: string[]; otherDomains: number; otherAccounts: number }
export interface AssignmentsResponse { gestores: GestorAssign[]; accounts: { id: string; name: string; provider: string }[]; domains: LinkDomain[] }

export const linksApi = {
  list: () => api.get<LinksResponse>('/links'),
  link: ({ accountId, ...b }: { accountId: string; domainIds: string[]; from?: string }) => api.put<{ ok: true; from: string; changed: boolean }>(`/links/${accountId}`, b),
  editHistory: ({ id, from }: { id: string; from: string }) => api.patch<{ ok: true }>(`/links/history/${id}`, { from }),
  deleteHistory: (id: string) => api.del<void>(`/links/history/${id}`),
  assignments: () => api.get<AssignmentsResponse>('/links/assignments'),
  saveAssignment: ({ userId, ...b }: { userId: string; domainIds?: string[]; accountIds?: string[] }) => api.put<{ ok: true }>(`/links/assignments/${userId}`, b),
};
