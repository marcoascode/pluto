/**
 * Contas de anúncios × Sites (vínculo com data). 0.18.8: só consulta e correção da data de uma mudança;
 * os vínculos usuário × domínio × conta são feitos em Usuários & Squads.
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

export const linksApi = {
  list: () => api.get<LinksResponse>('/links'),
  editHistory: ({ id, from }: { id: string; from: string }) => api.patch<{ ok: true }>(`/links/history/${id}`, { from }),
};
