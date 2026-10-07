import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyTheme, cacheTheme, cachedTheme, normalizeTheme, persistThemeChoice } from '../src/services/theme.ts';
import type { ThemeName } from '../src/types.ts';

test('day → evening → night persists and restores after reload', async () => {
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
    assert.equal(root.dataset.theme, theme, `${theme} applies immediately`);
    assert.equal(account.theme, theme, `${theme} is saved to the account`);
  }

  // A fresh app instance first uses the local cache, then applies the account snapshot.
  const reloadedRoot = { dataset: {} as DOMStringMap } as HTMLElement;
  const localAfterReload = cachedTheme('alice', storage);
  assert.equal(localAfterReload, 'night');
  applyTheme(localAfterReload || 'night', reloadedRoot);
  assert.equal(reloadedRoot.dataset.theme, 'night');
  applyTheme(normalizeTheme(account.theme), reloadedRoot);
  assert.equal(reloadedRoot.dataset.theme, 'night');
});

test('legacy theme values map to the new visual themes', () => {
  assert.equal(normalizeTheme('light'), 'day');
  assert.equal(normalizeTheme('dark'), 'night');
  assert.equal(normalizeTheme('sunset'), 'evening');
  assert.equal(normalizeTheme('evening'), 'evening');
});

test('frontend selectors and Database Rules accept the same three current ids', () => {
  const css = fs.readFileSync('src/styles.css', 'utf8');
  const rules = JSON.parse(fs.readFileSync('database.rules.json', 'utf8')) as { rules: { userSettings: { $uid: { theme: { '.validate': string } } } } };
  for (const theme of ['day', 'evening', 'night']) {
    assert.ok(css.includes(`data-theme=${theme}`), `CSS defines ${theme}`);
    assert.ok(rules.rules.userSettings.$uid.theme['.validate'].includes(`'${theme}'`), `Rules accept ${theme}`);
  }
  assert.ok(!css.includes('data-theme=sunset'));
  const evening = css.match(/:root\[data-theme=evening\]\{([^}]+)\}/)?.[1] || '';
  assert.match(evening, /--accent:#ffb936/);
  const hues = [...evening.matchAll(/#([a-f\d]{6})/gi)].map(([, hex]) => {
    const [r, g, b] = hex.match(/../g)!.map(part => parseInt(part, 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    if (!delta) return null;
    const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return (hue * 60 + 360) % 360;
  }).filter((hue): hue is number => hue !== null);
  assert.ok(hues.length > 0 && hues.every(hue => hue >= 25 && hue <= 50), 'the evening palette stays in brown, orange and amber hues');
});
