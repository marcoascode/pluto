import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { prefsApi } from '@/lib/api/endpoints';
import type { Preferences } from '@/types/api';
import { useAuth } from './AuthContext';

interface PrefsCtx { prefs: Preferences; update: (patch: Partial<Preferences>) => void }
const Ctx = createContext<PrefsCtx | null>(null);

/** Preferências por usuário (métricas escolhidas, densidade, ordem dos domínios…). Salvas no servidor. */
export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Preferences>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { if (user) prefsApi.get().then(setPrefs).catch(() => {}); else setPrefs({}); }, [user]);
  const update = (patch: Partial<Preferences>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => prefsApi.save(next).catch(() => {}), 600);
      return next;
    });
  };
  return <Ctx.Provider value={{ prefs, update }}>{children}</Ctx.Provider>;
}
export function usePrefs() {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePrefs fora do PrefsProvider');
  return c;
}
