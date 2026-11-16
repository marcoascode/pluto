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

export const profileTone = (s: MetaProfile['status']) => (s === 'valid' ? 'pos' : s === 'invalid' ? 'neg' : 'warn') as 'pos' | 'neg' | 'warn';
export const profileLabel = (s: MetaProfile['status']) => (s === 'valid' ? 'Token válido' : s === 'invalid' ? 'Token recusado' : 'Pendente');
