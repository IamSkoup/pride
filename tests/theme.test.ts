import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyTheme, cacheTheme, cachedTheme, normalizeTheme, persistThemeChoice } from '../src/services/theme.ts';
import type { ThemeName } from '../src/types.ts';

test('day, evening, and night savanna appearances persist and restore after reload', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const root = { dataset: {} as DOMStringMap } as HTMLElement;
  const account = { theme: 'night' as ThemeName };
  const persist = async (_uid: string, theme: ThemeName) => { account.theme = theme; };

  for (const theme of ['day', 'evening', 'night'] as const) {
    await persistThemeChoice('alice', theme, root, storage, persist);
    assert.equal(root.dataset.theme, theme);
    assert.equal(account.theme, theme);

    // A fresh app instance first uses the local cache, then applies the account snapshot.
    const reloadedRoot = { dataset: {} as DOMStringMap } as HTMLElement;
    const localAfterReload = cachedTheme('alice', storage);
    assert.equal(localAfterReload, theme);
    applyTheme(localAfterReload || 'night', reloadedRoot);
    assert.equal(reloadedRoot.dataset.theme, theme);
    applyTheme(normalizeTheme(account.theme), reloadedRoot);
    assert.equal(reloadedRoot.dataset.theme, theme);
  }
});

test('legacy and invalid theme values fall back to night', () => {
  for (const theme of ['day', 'evening', 'night']) assert.equal(normalizeTheme(theme), theme);
  for (const legacy of ['light', 'dark', 'sunset', 'unknown']) assert.equal(normalizeTheme(legacy), 'night');
});

test('appearance settings expose all three savanna choices', () => {
  const css = fs.readFileSync('src/styles.css', 'utf8');
  const settings = fs.readFileSync('src/pages/ProfilePage.tsx', 'utf8');
  const chat = fs.readFileSync('src/pages/chat/ChatPanel.tsx', 'utf8');
  const trail = fs.readFileSync('src/pages/TrailPage.tsx', 'utf8');
  const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8')) as { rules: { userSettings: { $uid: { theme: { '.validate': string } } } } };
  assert.ok(css.includes('--accent:#ffb267'));
  assert.ok(css.includes('.sunset-preview'));
  assert.ok(settings.includes('Дневная саванна'));
  assert.ok(settings.includes('Вечерняя саванна'));
  assert.ok(settings.includes('Ночная саванна'));
  assert.ok(css.includes(':root[data-theme="day"] .composer-wrap'), 'day mode gives the composer its readable light surface');
  assert.ok(css.includes(':root[data-theme="day"] .settings-card'), 'day mode styles settings cards with the active palette');
  assert.ok(css.includes(':root[data-theme="day"] .conversation[data-chat-background="day"]:before'), 'day mode applies the selected chat wallpaper');
  assert.ok(chat.includes("|| 'savanna'"), 'new chats default to the savanna wallpaper');
  assert.ok(trail.includes("chatBackground || 'savanna'"), 'My Trail inherits the selected chat wallpaper');
  assert.ok(rules.rules.userSettings.$uid.theme['.validate'].includes("'day'"));
  const palette = css.match(/:root\{([^}]+)\}/)?.[1] || '';
  const hues = [...palette.matchAll(/#([a-f\d]{6})/gi)].map(([, hex]) => {
    const [r, g, b] = hex.match(/../g)!.map(part => parseInt(part, 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    if (!delta) return null;
    const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return (hue * 60 + 360) % 360;
  }).filter((hue): hue is number => hue !== null);
  assert.ok(hues.length > 0 && hues.some(hue => hue >= 25 && hue <= 50), 'the palette includes warm savanna sunset colours');
});
