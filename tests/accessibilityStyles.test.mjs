import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

// Collect custom properties from every :root block (light) and every dark-theme block, in source order, resolving var() references.
const tokenBlocks = theme => {
  // Lookbehind (not a consumed group) so adjacent blocks such as `}\n:root{` followed by `}\nhtml[data-theme="dark"]{` are all found.
  const selector = theme === 'dark' ? /(?<=^|\}|\*\/)\s*(?::root|html\[data-theme="dark"\])\s*\{([^}]*)\}/g : /(?<=^|\}|\*\/)\s*:root\s*\{([^}]*)\}/g;
  const tokens = new Map();
  for (const [, body] of css.matchAll(selector)) for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) tokens.set(name, value.trim());
  return tokens;
};
const resolve = (tokens, name, depth = 0) => {
  const value = tokens.get(name);
  if (value === undefined || depth > 8) return undefined;
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  return reference ? resolve(tokens, reference[1], depth + 1) : value;
};
const hexToRgb = hex => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map(character => character + character).join('') : value;
  return [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16));
};
const luminance = ([r, g, b]) => [r, g, b].map(channel => { const value = channel / 255; return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (foreground, background) => {
  const [a, b] = [luminance(hexToRgb(foreground)), luminance(hexToRgb(background))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
const themes = Object.fromEntries(['light', 'dark'].map(theme => {
  const tokens = tokenBlocks(theme);
  return [theme, name => resolve(tokens, name)];
}));
const AA_TEXT = 4.5;
const AA_UI = 3;
const check = (theme, foreground, background, minimum, what) => {
  const [fg, bg] = [themes[theme](foreground) ?? foreground, themes[theme](background) ?? background];
  assert.match(fg, /^#/, `${theme}: ${foreground} resolves to a hex colour`);
  assert.match(bg, /^#/, `${theme}: ${background} resolves to a hex colour`);
  const ratio = contrast(fg, bg);
  assert.ok(ratio >= minimum, `${theme} ${what}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`);
};

test('filled controls meet AA text contrast in both themes, including hover fills', () => {
  for (const theme of ['light', 'dark']) {
    check(theme, '--on-encoding', '--encoding', AA_TEXT, 'primary button text');
    check(theme, '--on-encoding', '--encoding-dark', AA_TEXT, 'primary button hover');
    check(theme, '--on-optimization', '--optimization', AA_TEXT, 'Optimization button / tab text');
    check(theme, '--on-optimization', '--optimization-dark', AA_TEXT, 'Optimization button hover');
    check(theme, '--on-danger', '--danger', AA_TEXT, 'destructive confirmation text');
  }
});

test('accent text and brand text meet AA on the actual page, surface and soft backgrounds', () => {
  for (const theme of ['light', 'dark']) {
    check(theme, '--encoding', '--page', AA_TEXT, 'green accent text on page');
    check(theme, '--encoding', '--surface', AA_TEXT, 'green accent text on surface');
    check(theme, '--encoding', '--encoding-soft', AA_TEXT, 'green accent text on the open receipt header');
    check(theme, '--optimization', '--optimization-soft', AA_TEXT, 'purple accent text on its soft background');
    check(theme, '--brand-mark-color', '--page', AA_TEXT, 'brand eyebrow on page');
    check(theme, '--brand-mark-color', '--surface', AA_TEXT, 'brand eyebrow on card');
    check(theme, '--muted', '--page', AA_TEXT, 'muted text on page');
    check(theme, '--muted', '--surface', AA_TEXT, 'muted text on surface');
  }
  check('dark', '--encoding', '--selected-bg', AA_TEXT, 'green text on the selected result');
});

test('the dark-theme brand eyebrow no longer uses the dark brand blue', () => {
  assert.notEqual(themes.dark('--brand-mark-color').toLowerCase(), themes.light('--brand-blue').toLowerCase());
  assert.match(css, /\.brand-mark\{color:var\(--brand-mark-color\)!important\}/);
});

test('the keyboard focus colour is a solid colour with at least 3:1 against page and surface in both themes', () => {
  for (const theme of ['light', 'dark']) {
    check(theme, '--focus-color', '--page', AA_UI, 'focus ring on page');
    check(theme, '--focus-color', '--surface', AA_UI, 'focus ring on surface');
  }
  assert.match(css, /html\[lang\] body :focus-visible\{outline:3px solid var\(--focus-color\);outline-offset:2px\}/);
  assert.match(html, /<html lang="en">/, 'the focus rule keys on the html lang attribute');
});

test('compound controls show the focus ring on the wrapper (target amount and Optimization search)', () => {
  assert.match(css, /:is\(\.currency-input,\.optimization-search-wrap\):focus-within\{outline:3px solid var\(--focus-color\)/);
  assert.match(html, /class="currency-input target-input"[\s\S]*?id="targetAmount"/);
  assert.match(html, /class="optimization-search-wrap"[\s\S]*?id="optimizationSearch"/);
});

test('an outline is only removed from an element whose wrapper (or equivalent rule) provides the focus indicator', () => {
  const removals = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , body]) => /outline\s*:\s*(0|none)\b/.test(body)).map(([, selector]) => selector.trim());
  assert.ok(removals.length > 0);
  for (const selector of removals) assert.match(selector, /(currency-input|optimization-search-wrap)/, `unexpected outline removal: ${selector}`);
});

test('the selected Monthly Filing tab has a fill, bolder text and an underline bar in addition to colour', () => {
  assert.match(css, /\.monthly-filing-tabs \.workspace-tab\[aria-selected="true"\]\{background:var\(--encoding\)\}/);
  assert.match(css, /\.workspace-tab\[aria-selected="true"\]\{color:var\(--on-encoding\);font-weight:850;box-shadow:inset 0 -3px 0 var\(--tab-edge\)\}/);
  assert.match(css, /\.workspace-tab#optimizationTab\[aria-selected="true"\]\{color:var\(--on-optimization\)\}/);
  for (const theme of ['light', 'dark']) {
    check(theme, '--on-encoding', '--encoding', AA_TEXT, 'selected tab text');
    const unselected = themes[theme]('--muted');
    check(theme, unselected, '--surface', AA_TEXT, 'unselected tab text');
  }
  for (const id of ['monthlyFilingActiveTab', 'monthlyFilingArchivedTab']) assert.match(html, new RegExp(`id="${id}"[^>]*role="tab"[^>]*aria-selected=`));
});

test('the scan control stays keyboard focusable and shows a focus ring on its visible button', () => {
  assert.doesNotMatch(css, /\.scan-label input\{display:none\}/, 'the file input must not be removed from the tab order');
  const rule = css.match(/\.receipt-fields \.scan-label input\.receipt-photo\{([^}]*)\}/)?.[1] ?? '';
  assert.ok(rule, 'a visually-hidden rule exists for the receipt photo input');
  assert.doesNotMatch(rule, /display\s*:\s*none|visibility\s*:\s*hidden/);
  assert.match(css, /\.scan-label:focus-within \.scan-button\{outline:3px solid var\(--focus-color\);outline-offset:2px\}/);
  const photo = html.match(/<input class="receipt-photo"[^>]*>/)?.[0] ?? '';
  assert.match(photo, /type="file"/);
  assert.match(photo, /accept="image\/\*"/);
  assert.match(photo, /capture="environment"/);
  assert.doesNotMatch(photo, /tabindex="-1"|hidden/);
});

test('filled-control text colours are set per theme instead of a fixed white', () => {
  assert.match(css, /\.primary,\.floating-add,\.selected-badge\{color:var\(--on-encoding\)\}/);
  assert.match(css, /\.target-card \.primary,\.modal-actions \.primary\{color:var\(--on-optimization\)\}/);
  assert.match(css, /\.confirmation-modal\.is-danger #confirmationConfirm\{color:var\(--on-danger\)\}/);
});
