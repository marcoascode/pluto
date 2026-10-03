import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/lib/api/endpoints';
import { ApiError, setUnauthorizedHandler } from '@/lib/api/client';
import type { Capability, User } from '@/types/api';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  /** Pode abrir o módulo? Acesso Total sempre pode. O servidor também confere (403). */
  can: (cap: Capability) => boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const Ctx = createContext<AuthCtx | null>(null);

/** Sessão = cookie httpOnly gravado pelo Node no /auth/login. Aqui só lemos /auth/me. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try { setUser((await authApi.me()).user); } catch (e) { if (e instanceof ApiError && e.status === 401) setUser(null); else throw e; } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); qc.clear(); navigate('/login', { replace: true }); });
  }, [qc, navigate]);
  useEffect(() => { refresh().catch(() => setLoading(false)); }, [refresh]);

  const login = async (email: string, password: string) => { const { user } = await authApi.login({ email, password }); setUser(user); return user; };
  const logout = async () => { await authApi.logout().catch(() => {}); setUser(null); qc.clear(); navigate('/login', { replace: true }); };

  const can = (cap: Capability) => !!user && (user.role === 'total' || !!user.permissions?.includes(cap));
  return <Ctx.Provider value={{ user, loading, isAdmin: user?.role === 'total', can, login, logout, refresh }}>{children}</Ctx.Provider>;
}
export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fora do AuthProvider');
  return c;
}
