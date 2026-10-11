import type { ThemeName } from '../types';

export function normalizeTheme(value: unknown): ThemeName {
  return value === 'day' || value === 'evening' || value === 'night' ? value : 'night';
}

export function cachedTheme(uid: string, storage: Pick<Storage, 'getItem'> = localStorage): ThemeName | null {
  const value = storage.getItem(`pride-theme:${uid}`);
  return value ? normalizeTheme(value) : null;
}

export function cacheTheme(uid: string, theme: ThemeName, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(`pride-theme:${uid}`, theme);
}

export function applyTheme(theme: ThemeName, root: HTMLElement = document.documentElement) {
  const safeTheme = normalizeTheme(theme);
  root.dataset.theme = safeTheme;
  root.ownerDocument?.querySelector('meta[name="theme-color"]')?.setAttribute('content', safeTheme === 'day' ? '#dfc391' : safeTheme === 'evening' ? '#301d17' : '#171416');
}

export async function persistThemeChoice(
  uid: string | null,
  theme: ThemeName,
  root: HTMLElement,
  storage: Pick<Storage, 'setItem'>,
  persist: (uid: string, theme: ThemeName) => Promise<void>,
) {
  const safeTheme = normalizeTheme(theme);
  applyTheme(safeTheme, root);
  if (!uid) return;
  cacheTheme(uid, safeTheme, storage);
  await persist(uid, safeTheme);
}
