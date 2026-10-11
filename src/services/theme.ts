import type { ThemeName } from '../types';

export function normalizeTheme(_value: unknown): ThemeName {
  // Pride now has one savanna-at-dusk appearance. Normalize older saved choices.
  return 'night';
}

export function cachedTheme(uid: string, storage: Pick<Storage, 'getItem'> = localStorage): ThemeName | null {
  const value = storage.getItem(`pride-theme:${uid}`);
  return value ? normalizeTheme(value) : null;
}

export function cacheTheme(uid: string, _theme: ThemeName, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(`pride-theme:${uid}`, 'night');
}

export function applyTheme(_theme: ThemeName, root: HTMLElement = document.documentElement) {
  root.dataset.theme = 'night';
  root.ownerDocument?.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#29201d');
}

export async function persistThemeChoice(
  uid: string | null,
  _theme: ThemeName,
  root: HTMLElement,
  storage: Pick<Storage, 'setItem'>,
  persist: (uid: string, theme: ThemeName) => Promise<void>,
) {
  applyTheme('night', root);
  if (!uid) return;
  cacheTheme(uid, 'night', storage);
  await persist(uid, 'night');
}
