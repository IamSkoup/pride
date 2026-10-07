import { onAuthStateChanged, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { onValue, ref, set } from 'firebase/database';
import { auth, db } from '../services/firebase';
import { useFirebaseValue } from '../hooks/useFirebaseValue';
import { setPresence } from '../services/chats';
import { applyTheme, cacheTheme, cachedTheme, normalizeTheme, persistThemeChoice } from '../services/theme';
import type { Profile, ThemeName } from '../types';

type AuthState = { user: User | null; profile: Profile | null; loading: boolean; theme: ThemeName; setTheme: (theme: ThemeName) => Promise<void> };
const Context = createContext<AuthState>({ user: null, profile: null, loading: true, theme: 'night', setTheme: async () => {} });
export const useAuth = () => useContext(Context);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(auth));
  const [profile, profileLoading] = useFirebaseValue<Profile>(user ? `users/${user.uid}` : null);
  const [theme, setThemeState] = useState<ThemeName>('night');
  useEffect(() => auth ? onAuthStateChanged(auth, next => { setUser(next); setAuthLoading(false); }) : void setAuthLoading(false), []);
  useEffect(() => { if (user) setPresence(user.uid).catch(() => {}); }, [user?.uid]);
  useEffect(() => {
    if (!user) { setThemeState('night'); return; }
    const uid = user.uid;
    setThemeState(cachedTheme(uid) || 'night');
    if (!db) return;
    return onValue(ref(db, `userSettings/${uid}/theme`), snapshot => {
      if (snapshot.val() === null) return;
      const saved = normalizeTheme(snapshot.val());
      setThemeState(saved);
      cacheTheme(uid, saved);
    }, error => console.warn('Could not sync Pride theme from Firebase:', error.message));
  }, [user?.uid]);
  useEffect(() => { applyTheme(theme); }, [theme]);
  const setTheme = useCallback(async (next: ThemeName) => {
    setThemeState(next);
    try {
      await persistThemeChoice(user?.uid || null, next, document.documentElement, localStorage, async (uid, value) => {
        if (db) await set(ref(db, `userSettings/${uid}/theme`), value);
      });
    } catch (error) {
      // RTDB rolls back its optimistic event when rules/network reject a write.
      // Keep the local choice active and cached while informing the caller.
      setThemeState(next);
      applyTheme(next);
      if (user) cacheTheme(user.uid, next);
      throw error;
    }
  }, [user?.uid]);
  return <Context.Provider value={{ user, profile, loading: authLoading || Boolean(user && profileLoading), theme, setTheme }}>{children}</Context.Provider>;
}
