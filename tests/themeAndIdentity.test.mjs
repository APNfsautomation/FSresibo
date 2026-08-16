import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { appMetadata } from '../config/appMetadata.js';
import { renderApplicationIdentity } from '../ui/appIdentity.js';
import { createThemeController, themeStorageKey } from '../ui/themeController.js';

const eventTarget = () => {
  const listeners = new Map();
  return { addEventListener: (name, callback) => listeners.set(name, callback), emit: name => listeners.get(name)?.(), listeners };
};

test('System theme follows OS changes and explicit preference persists locally', () => {
  const select = { value: '', ...eventTarget() };
  const root = { dataset: {}, style: {} };
  const storage = new Map();
  const media = { matches: true, ...eventTarget() };
  const controller = createThemeController({ select, root, storage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }, media });
  controller.restore();
  assert.equal(select.value, 'system');
  assert.equal(root.dataset.theme, 'dark');
  media.matches = false;
  media.emit('change');
  assert.equal(root.dataset.theme, 'light');
  select.value = 'dark';
  select.emit('change');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(storage.get(themeStorageKey), 'dark');
});

test('both version targets render from the one application metadata value', () => {
  const authVersion = { textContent: '' };
  const appVersion = { textContent: '' };
  const label = renderApplicationIdentity([authVersion, appVersion], appMetadata);
  assert.equal(label, 'FSResibo v2.6.0-beta.2');
  assert.equal(authVersion.textContent, label);
  assert.equal(appVersion.textContent, label);
});

test('native selects request a matching browser color scheme and dark option fallback', async () => {
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(styles, /html\[data-theme="dark"\] select\{color-scheme:dark\}/);
  assert.match(styles, /html\[data-theme="dark"\] select option,html\[data-theme="dark"\] select optgroup\{background-color:var\(--control\);color:var\(--text\)\}/);
});
