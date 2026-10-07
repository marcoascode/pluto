import { q, type Db } from '../db.js';

export type Role = 'gestor' | 'gerente' | 'admin' | 'superadmin';
export const ROLES: Role[] = ['gestor', 'gerente', 'admin', 'superadmin'];
/** Papéis com módulos configuráveis em Permissões (só visualização). */
export type ViewRole = 'gestor' | 'gerente';
export const isAdminRole = (r: string) => r === 'admin' || r === 'superadmin';

/**
 * Mesma lista do front (src/types/api.ts → Capability).
 * - adminOnly: nunca vai para Gestor nem Gerente.
 * - superAdminOnly: só o SuperAdmin (conectar integrações e mudar a frequência do sync).
 */
export const CAPABILITIES = [
  { key: 'reports.view', label: 'Relatórios (dia e mês)', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'urls.view', label: 'URLs e Drop-off', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'campaigns.google.view', label: 'Google Ads', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'campaigns.meta.view', label: 'Meta Ads', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'gam.view', label: 'Google Ad Manager', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'attribution.view', label: 'Attribution Health', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'utm.debug', label: 'UTM Debugger', group: 'Visualização', adminOnly: false, superAdminOnly: false },
  { key: 'admin.integrations', label: 'Contas das integrações (cadastrar, editar, importar, excluir)', group: 'Administração', adminOnly: true, superAdminOnly: false },
  { key: 'admin.integrations.connect', label: 'Conectar integrações (OAuth) e editar a frequência do sync', group: 'Administração', adminOnly: true, superAdminOnly: true },
  { key: 'admin.users', label: 'Usuários, Squads e permissões', group: 'Administração', adminOnly: true, superAdminOnly: false },
  { key: 'admin.domains', label: 'Domínios e revShare', group: 'Administração', adminOnly: true, superAdminOnly: false },
  { key: 'admin.utms', label: 'UTMs globais', group: 'Administração', adminOnly: true, superAdminOnly: false },
  { key: 'admin.currency', label: 'Moedas e câmbio', group: 'Administração', adminOnly: true, superAdminOnly: false },
] as const;
export type Capability = (typeof CAPABILITIES)[number]['key'];
export const ALL_CAPS = CAPABILITIES.map((c) => c.key) as Capability[];
export const ADMIN_CAPS = CAPABILITIES.filter((c) => !c.superAdminOnly).map((c) => c.key) as Capability[];
export const GESTOR_ALLOWED = new Set<Capability>(CAPABILITIES.filter((c) => !c.adminOnly).map((c) => c.key));

let cache: { at: number; caps: Record<ViewRole, Capability[]> } | null = null;
async function viewCaps(db?: Db): Promise<Record<ViewRole, Capability[]>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.caps;
  const rows = await q<{ role: ViewRole; capability: Capability }>(`SELECT role, capability FROM role_permissions WHERE role IN ('gestor', 'gerente')`, [], db);
  const pick = (role: ViewRole) => rows.filter((r) => r.role === role).map((r) => r.capability).filter((c) => GESTOR_ALLOWED.has(c));
  cache = { at: Date.now(), caps: { gestor: pick('gestor'), gerente: pick('gerente') } };
  return cache.caps;
}
export const gestorCaps = async (db?: Db) => (await viewCaps(db)).gestor;
export const clearPermCache = () => { cache = null; };

export async function capsOf(role: string): Promise<Capability[]> {
  if (role === 'superadmin') return ALL_CAPS;
  if (role === 'admin') return ADMIN_CAPS;
  const v = await viewCaps();
  return role === 'gerente' ? v.gerente : v.gestor;
}
export async function rolesMatrix() {
  const v = await viewCaps();
  return { gestor: v.gestor, gerente: v.gerente, admin: ADMIN_CAPS, superadmin: ALL_CAPS };
}
export const ROLE_LABEL: Record<Role, string> = { gestor: 'Gestor', gerente: 'Gerente', admin: 'Admin', superadmin: 'SuperAdmin' };
