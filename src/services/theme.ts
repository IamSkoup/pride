import type { ThemeName } from '../types';

export function normalizeTheme(value: unknown): ThemeName {
  if (value === 'day' || value === 'light') return 'day';
  if (value === 'evening' || value === 'sunset') return 'evening';
  return 'night';
}

export function cachedTheme(uid: string, storage: Pick<Storage, 'getItem'> = localStorage): ThemeName | null {
  const value = storage.getItem(`pride-theme:${uid}`);
  return value ? normalizeTheme(value) : null;
}

export function cacheTheme(uid: string, theme: ThemeName, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(`pride-theme:${uid}`, theme);
}

export function applyTheme(theme: ThemeName, root: HTMLElement = document.documentElement) {
  root.dataset.theme = theme;
  const colors: Record<ThemeName, string> = { day: '#d9c18f', evening: '#241b13', night: '#171512' };
  root.ownerDocument?.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors[theme]);
}

export async function persistThemeChoice(
  uid: string | null,
  theme: ThemeName,
  root: HTMLElement,
  storage: Pick<Storage, 'setItem'>,
  persist: (uid: string, theme: ThemeName) => Promise<void>,
) {
  applyTheme(theme, root);
  if (!uid) return;
  cacheTheme(uid, theme, storage);
  await persist(uid, theme);
}
