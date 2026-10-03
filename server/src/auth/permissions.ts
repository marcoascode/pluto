import { q, type Db } from '../db.js';

/** Mesma lista do front (src/types/api.ts → Capability). adminOnly nunca pode ir para o Gestor. */
export const CAPABILITIES = [
  { key: 'reports.view', label: 'Relatórios (dia e mês)', group: 'Visualização', adminOnly: false },
  { key: 'urls.view', label: 'URLs e Drop-off', group: 'Visualização', adminOnly: false },
  { key: 'campaigns.google.view', label: 'Google Ads', group: 'Visualização', adminOnly: false },
  { key: 'campaigns.meta.view', label: 'Meta Ads', group: 'Visualização', adminOnly: false },
  { key: 'gam.view', label: 'Google Ad Manager', group: 'Visualização', adminOnly: false },
  { key: 'attribution.view', label: 'Attribution Health', group: 'Visualização', adminOnly: false },
  { key: 'utm.debug', label: 'UTM Debugger', group: 'Visualização', adminOnly: false },
  { key: 'admin.integrations', label: 'Conectar APIs e contas / frequência do sync', group: 'Administração', adminOnly: true },
  { key: 'admin.users', label: 'Usuários, Squads e permissões', group: 'Administração', adminOnly: true },
  { key: 'admin.domains', label: 'Domínios', group: 'Administração', adminOnly: true },
  { key: 'admin.utms', label: 'UTMs globais', group: 'Administração', adminOnly: true },
  { key: 'admin.currency', label: 'Moedas e câmbio', group: 'Administração', adminOnly: true },
] as const;
export type Capability = (typeof CAPABILITIES)[number]['key'];
export const ALL_CAPS = CAPABILITIES.map((c) => c.key) as Capability[];
export const GESTOR_ALLOWED = new Set<Capability>(CAPABILITIES.filter((c) => !c.adminOnly).map((c) => c.key));

let cache: { at: number; gestor: Capability[] } | null = null;
export async function gestorCaps(db?: Db): Promise<Capability[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.gestor;
  const rows = await q<{ capability: Capability }>(`SELECT capability FROM role_permissions WHERE role = 'gestor'`, [], db);
  const gestor = rows.map((r) => r.capability).filter((c) => GESTOR_ALLOWED.has(c));
  cache = { at: Date.now(), gestor };
  return gestor;
}
export const clearPermCache = () => { cache = null; };
export async function capsOf(role: string): Promise<Capability[]> {
  return role === 'total' ? ALL_CAPS : gestorCaps();
}
