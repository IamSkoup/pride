import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyTheme, cacheTheme, cachedTheme, normalizeTheme, persistThemeChoice } from '../src/services/theme.ts';
import type { ThemeName } from '../src/types.ts';

test('the savanna-at-dusk appearance persists and restores after reload', async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  const root = { dataset: {} as DOMStringMap } as HTMLElement;
  const account = { theme: 'night' as ThemeName };
  const persist = async (_uid: string, theme: ThemeName) => { account.theme = theme; };

  await persistThemeChoice('alice', 'night', root, storage, persist);
  assert.equal(root.dataset.theme, 'night');
  assert.equal(account.theme, 'night');

  // A fresh app instance first uses the local cache, then applies the account snapshot.
  const reloadedRoot = { dataset: {} as DOMStringMap } as HTMLElement;
  const localAfterReload = cachedTheme('alice', storage);
  assert.equal(localAfterReload, 'night');
  applyTheme(localAfterReload || 'night', reloadedRoot);
  assert.equal(reloadedRoot.dataset.theme, 'night');
  applyTheme(normalizeTheme(account.theme), reloadedRoot);
  assert.equal(reloadedRoot.dataset.theme, 'night');
});

test('all saved theme choices resolve to the single dusk appearance', () => {
  for (const legacy of ['light', 'dark', 'sunset', 'day', 'evening', 'night']) assert.equal(normalizeTheme(legacy), 'night');
});

test('appearance settings have one fixed savanna palette', () => {
  const css = fs.readFileSync('src/styles.css', 'utf8');
  const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8')) as { rules: { userSettings: { $uid: { theme: { '.validate': string } } } } };
  assert.ok(css.includes('--accent:#ffb267'));
  assert.ok(css.includes('.sunset-preview'));
  assert.ok(!css.includes('Дневная саванна'));
  assert.ok(rules.rules.userSettings.$uid.theme['.validate'].includes("'night'"));
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
