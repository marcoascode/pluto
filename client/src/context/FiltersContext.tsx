import { createContext, useContext, useMemo, useState } from 'react';
import type { Currency, PeriodQuery } from '@/types/api';
import { rangeFor, type PeriodPreset } from '@/lib/period';

interface FiltersCtx {
  preset: PeriodPreset;
  from: string;
  to: string;
  domain: string;
  currency: Currency;
  query: PeriodQuery; // pronto para mandar à API
  setPreset: (p: PeriodPreset) => void;
  setCustom: (from: string, to: string) => void;
  setDomain: (d: string) => void;
  setCurrency: (c: Currency) => void;
}
const Ctx = createContext<FiltersCtx | null>(null);

/** Filtros do topo (Data, Domínio, Moeda). A Data sempre abre em "Hoje". */
export function FiltersProvider({ children }: { children: React.ReactNode }) {
  const [preset, setPresetState] = useState<PeriodPreset>('today');
  const [custom, setCustomState] = useState<{ from: string; to: string } | undefined>();
  const [domain, setDomain] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const { from, to } = rangeFor(preset, custom);
  const query = useMemo<PeriodQuery>(() => ({ from, to, domain: domain || undefined, currency }), [from, to, domain, currency]);
  const value: FiltersCtx = {
    preset, from, to, domain, currency, query,
    setPreset: (p) => setPresetState(p),
    setCustom: (f, t) => { setCustomState({ from: f <= t ? f : t, to: f <= t ? t : f }); setPresetState('custom'); },
    setDomain, setCurrency,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useFilters() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useFilters fora do FiltersProvider');
  return c;
}
