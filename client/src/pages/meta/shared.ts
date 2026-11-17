import type { MetaProfile } from '@/types/api';

/** Página padrão de cada Perfil: conveniência por navegador (nada sensível; o servidor revalida a Página ao publicar). */
const KEY = 'pluto.meta.defaultPage';
function read(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>; } catch { return {}; }
}
export const getDefaultPage = (profileId: string): string => read()[profileId] ?? '';
export function setDefaultPage(profileId: string, pageId: string) {
  try { const m = read(); if (pageId) m[profileId] = pageId; else delete m[profileId]; localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* sem storage: segue sem o padrão */ }
}

export const profileTone = (s: MetaProfile['status']) => (s === 'valid' ? 'pos' : s === 'invalid' || s === 'expired' ? 'neg' : 'warn') as 'pos' | 'neg' | 'warn';
export const profileLabel = (s: MetaProfile['status']) => (s === 'valid' ? 'Ativo' : s === 'expired' ? 'Token vencido' : s === 'invalid' ? 'Token recusado' : 'Pendente');

/** Dias inteiros até o token vencer (null = não expira). Negativo = já venceu. */
export const daysLeft = (p: Pick<MetaProfile, 'tokenExpiresAt'>, now = Date.now()): number | null =>
  p.tokenExpiresAt ? Math.floor((Date.parse(p.tokenExpiresAt) - now) / 864e5) : null;
/** A partir de quantos dias para vencer o botão "Reconectar / Renovar" ganha destaque. */
export const RENEW_WARN_DAYS = 10;
/** Perfil utilizável no Wizard: token aceito pela Meta e dentro da validade. */
export const profileUsable = (p: Pick<MetaProfile, 'status' | 'tokenExpiresAt'>) => p.status === 'valid' && (daysLeft(p) ?? 1) >= 0;
