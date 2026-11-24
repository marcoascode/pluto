/**
 * 0.18.9 · Gerente (e Admin) atribuem domínios e contas aos gestores — Usuários & Squads → Gestores.
 * O servidor só deixa o Gerente mexer nos domínios e contas do alcance dele; o resto do gestor fica como está.
 */
import { api } from '@/lib/api/client';
import type { DomainLink } from '@/types/api';

export interface TeamAccount { id: string; name: string; externalId: string }
export interface TeamGestor { id: string; name: string; email: string; status: string; domains: DomainLink[]; otherDomains: number }
export interface TeamResponse {
  viewer: { role: string };
  gestores: TeamGestor[];
  domains: { id: string; hostname: string; active: boolean }[];
  accounts: { google: TeamAccount[]; meta: TeamAccount[] };
}
export const teamApi = {
  list: () => api.get<TeamResponse>('/team'),
  save: ({ id, domains }: { id: string; domains: DomainLink[] }) => api.put<{ ok: true }>(`/team/gestores/${id}`, { domains }),
};
