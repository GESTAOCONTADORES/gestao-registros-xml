import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionDTO, UserDTO } from '@gestao/shared';
import { api, onSessionChange, refreshSession, setAccessToken } from '../api/client';

interface AuthState {
  user: UserDTO | null;
  loading: boolean;
  isMaster: boolean;
  login: (username: string, password: string) => Promise<UserDTO>;
  logout: () => Promise<void>;
  setUser: (u: UserDTO) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onSessionChange((s) => {
      if (s) setUser(s.user);
      else {
        setAccessToken(null);
        setUser(null);
      }
    });
    // ao abrir o sistema, tenta recuperar a sessão pelo refresh token (cookie httpOnly)
    refreshSession()
      .then((s) => setUser(s?.user ?? null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const s = await api<SessionDTO>('/auth/login', { method: 'POST', body: { username, password }, noRefresh: true });
    setAccessToken(s.accessToken);
    setUser(s.user);
    return s.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {}, noRefresh: true });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, isMaster: user?.role === 'MASTER', login, logout, setUser }),
    [user, loading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}
