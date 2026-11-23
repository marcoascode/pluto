import { createContext, useContext, useMemo, useState } from 'react';
import type { PeriodQuery } from '@/types/api';
import { rangeFor, type PeriodPreset } from '@/lib/period';

interface FiltersCtx {
  preset: PeriodPreset;
  from: string;
  to: string;
  domain: string;
  /** Empresa escolhida no topo ('' = todas). Vai em toda chamada como ?company=. */
  company: string;
  query: PeriodQuery; // pronto para mandar à API
  setPreset: (p: PeriodPreset) => void;
  setCustom: (from: string, to: string) => void;
  setDomain: (d: string) => void;
  setCompany: (id: string) => void;
}
const Ctx = createContext<FiltersCtx | null>(null);

/** Filtros do topo (Data, Domínio, Empresa). Sem moeda (0.18.6): receita sempre em USD, despesas e ROI sempre em BRL. A Data sempre abre em "Hoje"; a Empresa fica lembrada no navegador. */
export function FiltersProvider({ children }: { children: React.ReactNode }) {
  const [preset, setPresetState] = useState<PeriodPreset>('today');
  const [custom, setCustomState] = useState<{ from: string; to: string } | undefined>();
  const [domain, setDomain] = useState('');
  const [company, setCompanyState] = useState(() => { try { return localStorage.getItem('pluto_company') ?? ''; } catch { return ''; } });
  const { from, to } = rangeFor(preset, custom);
  const query = useMemo<PeriodQuery>(() => ({ from, to, domain: domain || undefined, company: company || undefined }), [from, to, domain, company]);
  const value: FiltersCtx = {
    preset, from, to, domain, company, query,
    setPreset: (p) => setPresetState(p),
    setCustom: (f, t) => { setCustomState({ from: f <= t ? f : t, to: f <= t ? t : f }); setPresetState('custom'); },
    setDomain,
    // trocar de Empresa limpa o domínio (ele pode não ser da outra Empresa)
    setCompany: (id) => { setCompanyState(id); setDomain(''); try { localStorage.setItem('pluto_company', id); } catch { /* sem storage */ } },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useFilters() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useFilters fora do FiltersProvider');
  return c;
}
