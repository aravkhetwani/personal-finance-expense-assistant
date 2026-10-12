import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');

  const logoutLocal = useCallback((msg) => {
    setToken(null);
    setUser(null);
    if (msg) setNotice(msg);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler((msg) => logoutLocal(msg || 'Please sign in again.'));
    if (!getToken()) { setReady(true); return; }
    api.get('/auth/me').then((d) => setUser(d.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, [logoutLocal]);

  const value = useMemo(
    () => ({
      user, ready, notice, clearNotice: () => setNotice(''),
      setUser,
      signIn(token, u) { setToken(token); setUser(u); setNotice(''); },
      async signOut() {
        try { await api.post('/auth/logout'); } catch { /* already ended */ }
        logoutLocal();
      },
      async refresh() { const d = await api.get('/auth/me'); setUser(d.user); return d.user; },
    }),
    [user, ready, notice, logoutLocal]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
