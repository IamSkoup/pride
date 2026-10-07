import { onAuthStateChanged, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth } from '../services/firebase';
import { useFirebaseValue } from '../hooks/useFirebaseValue';
import { setPresence } from '../services/chats';
import type { Profile } from '../types';

type AuthState = { user: User | null; profile: Profile | null; loading: boolean };
const Context = createContext<AuthState>({ user: null, profile: null, loading: true });
export const useAuth = () => useContext(Context);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(auth));
  const [profile, profileLoading] = useFirebaseValue<Profile>(user ? `users/${user.uid}` : null);
  const [theme] = useFirebaseValue<string>(user ? `userSettings/${user.uid}/theme` : null);
  useEffect(() => auth ? onAuthStateChanged(auth, next => { setUser(next); setAuthLoading(false); }) : void setAuthLoading(false), []);
  useEffect(() => { if (user) setPresence(user.uid).catch(() => {}); }, [user]);
useEffect(() => { document.documentElement.dataset.theme = theme === 'light' ? 'day' : theme === 'dark' || !theme ? 'night' : theme; }, [theme]);
  return <Context.Provider value={{ user, profile, loading: authLoading || Boolean(user && profileLoading) }}>{children}</Context.Provider>;
}
