import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const authCss = await readFile(new URL('../auth.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

// ---- tiny CSS reader: formatting-independent rules and theme tokens ------------------------------
const withoutComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '');
const clean = withoutComments(css);
const rules = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
  selectors: selector.split(/,(?![^()]*\))/).map(part => part.replace(/\s+/g, ' ').trim()),
  declarations: Object.fromEntries(body.split(';').map(part => part.trim()).filter(Boolean).map(part => { const index = part.indexOf(':'); return [part.slice(0, index).trim(), part.slice(index + 1).trim().replace(/\s*!important$/, '')]; }))
}));
const rulesFor = selector => rules.filter(rule => rule.selectors.includes(selector));
const declared = (selector, property) => rulesFor(selector).map(rule => rule.declarations[property]).filter(value => value !== undefined).pop();

const tokenBlocks = theme => {
  const selector = theme === 'dark' ? /(?<=^|\}|\*\/)\s*(?::root|html\[data-theme="dark"\])\s*\{([^}]*)\}/g : /(?<=^|\}|\*\/)\s*:root\s*\{([^}]*)\}/g;
  const tokens = new Map();
  for (const [, body] of css.matchAll(selector)) for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) tokens.set(name, value.trim());
  return tokens;
};
const lightTokens = tokenBlocks('light');
const darkOverrides = new Map([...tokenBlocks('dark')].filter(([name, value]) => lightTokens.get(name) !== value));
const resolve = (tokens, name, depth = 0) => {
  const value = tokens.get(name);
  if (value === undefined || depth > 8) return undefined;
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  return reference ? resolve(tokens, reference[1], depth + 1) : value;
};
const hexToRgb = hex => { const value = hex.replace('#', ''); const full = value.length === 3 ? [...value].map(character => character + character).join('') : value; return [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16)); };
const luminance = rgb => rgb.map(channel => { const value = channel / 255; return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (foreground, background) => { const [a, b] = [luminance(hexToRgb(foreground)), luminance(hexToRgb(background))]; return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
const themes = { light: name => resolve(lightTokens, name), dark: name => resolve(tokenBlocks('dark'), name) };
const AA_TEXT = 4.5;
const AA_UI = 3;
const check = (theme, foreground, background, minimum, what) => {
  const [fg, bg] = [themes[theme](foreground) ?? foreground, themes[theme](background) ?? background];
  assert.match(fg, /^#/, `${theme}: ${foreground} resolves to a hex colour`);
  assert.match(bg, /^#/, `${theme}: ${background} resolves to a hex colour`);
  const ratio = contrast(fg, bg);
  assert.ok(ratio >= minimum, `${theme} ${what}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`);
};

test('both themes map the same semantic colour tokens', () => {
  const semantic = ['--page', '--surface', '--surface-2', '--text', '--muted', '--border', '--border-strong', '--control', '--control-border',
    '--primary', '--primary-hover', '--primary-soft', '--on-primary', '--success', '--success-soft', '--success-border', '--on-success',
    '--warning', '--warning-soft', '--warning-border', '--danger', '--danger-soft', '--danger-border', '--on-danger', '--focus-color', '--scrim', '--status-bg', '--status-text'];
  for (const name of semantic) {
    assert.ok(lightTokens.has(name), `light theme defines ${name}`);
    assert.ok(darkOverrides.has(name) || tokenBlocks('dark').has(name), `dark theme defines ${name}`);
  }
  for (const group of ['--space-1', '--space-4', '--radius-sm', '--radius-md', '--radius-lg', '--shadow-sm', '--shadow-lg', '--text-md', '--weight-bold', '--leading-body', '--control-height']) assert.ok(lightTokens.has(group), `${group} exists`);
  assert.ok(darkOverrides.size > 15, 'dark theme overrides the colour roles instead of inheriting light values');
});

test('filled controls meet AA text contrast in both themes, including hover fills', () => {
  for (const theme of ['light', 'dark']) {
    check(theme, '--on-primary', '--primary', AA_TEXT, 'primary button / selected tab text');
    check(theme, '--on-primary', '--primary-hover', AA_TEXT, 'primary button hover');
    check(theme, '--on-success', '--success', AA_TEXT, 'selected badge text');
    check(theme, '--on-danger', '--danger', AA_TEXT, 'destructive confirmation text');
  }
});

test('accent, status and body text meet AA on the surfaces they are drawn on', () => {
  for (const theme of ['light', 'dark']) {
    for (const surface of ['--page', '--surface', '--surface-2']) {
      check(theme, '--text', surface, AA_TEXT, 'body text');
      check(theme, '--muted', surface, AA_TEXT, 'secondary text');
    }
    for (const surface of ['--page', '--surface', '--primary-soft']) check(theme, '--primary', surface, AA_TEXT, 'primary accent text');
    for (const surface of ['--page', '--surface', '--success-soft']) check(theme, '--success', surface, AA_TEXT, 'success text');
    check(theme, '--success', '--selected-bg', AA_TEXT, 'text on a selected row');
    for (const surface of ['--surface', '--surface-2']) check(theme, '--warning', surface, AA_TEXT, 'warning text');
    check(theme, '--danger', '--danger-soft', AA_TEXT, 'destructive button text');
    check(theme, '--danger', '--surface', AA_TEXT, 'danger text');
    check(theme, '--status-text', '--status-bg', AA_TEXT, 'status chip text');
  }
});

test('interactive boundaries and the keyboard focus colour stay distinguishable in both themes', () => {
  for (const theme of ['light', 'dark']) {
    check(theme, '--control-border', '--control', AA_UI, 'form control border');
    check(theme, '--control-border', '--surface', AA_UI, 'form control border on a card');
    for (const surface of ['--page', '--surface', '--primary-soft', '--success-soft', '--surface-2']) check(theme, '--focus-color', surface, AA_UI, 'focus ring');
  }
  assert.match(clean, /html\[lang\] body :focus-visible\s*\{\s*outline:\s*3px solid var\(--focus-color\);\s*outline-offset:\s*2px;?\s*\}/);
  assert.match(html, /<html lang="en">/, 'the focus rule keys on the html lang attribute');
});

test('the company signature slash is visible in both themes and is never used for controls', () => {
  for (const theme of ['light', 'dark']) {
    check(theme, '--sig-blue', '--surface', AA_UI, 'brand slash blue');
    check(theme, '--sig-red', '--surface', AA_UI, 'brand slash red');
  }
  assert.match(declared('.brand-slash', 'background'), /var\(--sig-blue\).*var\(--sig-red\)/);
  const users = rules.filter(rule => Object.values(rule.declarations).some(value => /--sig-(blue|red)/.test(value))).flatMap(rule => rule.selectors);
  assert.deepEqual(users, ['.brand-slash'], 'only the slash uses the company colours');
});

test('compound controls show the focus ring on the wrapper (target amount and Optimization search)', () => {
  const wrapper = rules.find(rule => rule.selectors.some(selector => /:is\(\.currency-input, ?\.optimization-search-wrap\):focus-within/.test(selector)));
  assert.ok(wrapper, 'a :focus-within rule exists for the compound controls');
  assert.match(wrapper.declarations.outline, /^3px solid var\(--focus-color\)$/);
  assert.match(html, /class="currency-input target-input"[\s\S]*?id="targetAmount"/);
  assert.match(html, /class="optimization-search-wrap"[\s\S]*?id="optimizationSearch"/);
});

test('an outline is only removed from an element whose wrapper (or equivalent rule) provides the focus indicator', () => {
  const removals = rules.filter(rule => /^(0|none)$/.test(rule.declarations.outline ?? '')).flatMap(rule => rule.selectors);
  assert.ok(removals.length > 0);
  for (const selector of removals) assert.match(selector, /(currency-input|optimization-search-wrap)/, `unexpected outline removal: ${selector}`);
});

test('every tab uses a fill, bolder text and an underline bar when selected, in addition to colour', () => {
  const rule = rulesFor('.workspace-tab[aria-selected="true"]').pop();
  assert.ok(rule);
  assert.equal(rule.declarations.background, 'var(--primary)');
  assert.equal(rule.declarations.color, 'var(--on-primary)');
  assert.equal(rule.declarations['font-weight'], '850');
  assert.match(rule.declarations['box-shadow'], /^inset 0 -3px 0 var\(--tab-edge\)$/);
  for (const theme of ['light', 'dark']) check(theme, themes[theme]('--muted'), '--surface', AA_TEXT, 'unselected tab text');
  for (const id of ['encodingTab', 'optimizationTab', 'monthlyFilingActiveTab', 'monthlyFilingArchivedTab']) assert.match(html, new RegExp(`id="${id}"[^>]*role="tab"[^>]*aria-selected=`));
});

test('the scan control stays keyboard focusable and shows a focus ring on its visible button', () => {
  assert.equal(rulesFor('.scan-label input').filter(rule => /none/.test(rule.declarations.display ?? '')).length, 0, 'the file input must not be removed from the tab order');
  const hidden = rulesFor('.receipt-fields .scan-label input.receipt-photo').pop();
  assert.ok(hidden, 'a visually-hidden rule exists for the receipt photo input');
  assert.doesNotMatch(`${hidden.declarations.display} ${hidden.declarations.visibility}`, /none|hidden/);
  assert.equal(declared('.scan-label:focus-within .scan-button', 'outline'), '3px solid var(--focus-color)');
  const photo = html.match(/<input class="receipt-photo"[^>]*>/)?.[0] ?? '';
  assert.match(photo, /type="file"/);
  assert.match(photo, /accept="image\/\*"/);
  assert.match(photo, /capture="environment"/);
  assert.doesNotMatch(photo, /tabindex="-1"|hidden/);
});

test('filled controls take their text colour from the per-theme tokens', () => {
  assert.equal(declared('.primary', 'background'), 'var(--primary)');
  assert.equal(declared('.primary', 'color'), 'var(--on-primary)');
  // Add receipt is a secondary action-bar button (CP8): it takes the secondary text colour and is no longer a fixed filled pill.
  assert.equal(declared('.secondary', 'color'), 'var(--text)');
  assert.equal(declared('.floating-add', 'position'), undefined);
  assert.equal(declared('.selected-badge', 'color'), 'var(--on-success)');
  assert.equal(declared('.selected-badge', 'background'), 'var(--success)');
  assert.equal(declared('.confirmation-modal.is-danger #confirmationConfirm', 'color'), 'var(--on-danger)');
  assert.equal(declared('.confirmation-modal.is-danger #confirmationConfirm', 'background'), 'var(--danger)');
});

test('buttons share one system: variants, disabled and busy states, and a minimum touch height', () => {
  assert.match(declared('button', 'min-height'), /var\(--control-height\)/);
  assert.equal(lightTokens.get('--control-height'), '40px');
  assert.match(clean, /@media \(pointer: coarse\)\s*\{\s*:root\s*\{\s*--control-height:\s*44px;/, 'touch devices get 44px controls');
  for (const selector of ['.primary', '.secondary', '.ghost', '.danger']) assert.ok(rulesFor(selector).length > 0, `${selector} variant is styled`);
  assert.ok(rules.some(rule => rule.selectors.includes('button:disabled')), 'disabled buttons are styled');
  assert.ok(rules.some(rule => rule.selectors.includes('button[aria-busy="true"]')), 'busy buttons are styled');
  assert.equal(declared('.navigation-item', 'min-height'), '44px');
  assert.equal(declared('.workspace-tab', 'min-height'), '44px');
});

test('form controls use at least 16px text, a shared border and the themed control surface', () => {
  assert.equal(lightTokens.get('--text-md'), '1rem');
  assert.equal(declared('input', 'font-size'), 'var(--text-md)');
  const sharedSelector = '.receipt-fields input';
  const shared = rulesFor(sharedSelector).find(rule => rule.declarations['min-height']);
  assert.ok(shared, 'receipt fields share the common control rule');
  assert.equal(shared.declarations['border'], 'var(--border-width) solid var(--control-border)');
  assert.equal(shared.declarations.background, 'var(--control)');
  for (const selector of ['.receipt-fields select', '.modal-fields input', '.optimization-strategy', '.toolbar-sort select', '.filter-fields input', '.receipt-status-filter select', '.encoding-compartment-filter select', '.quick-controls textarea', '.auth-form input', '.currency-input', '.optimization-search-wrap']) {
    assert.ok(rulesFor(selector).some(rule => rule.declarations.background === 'var(--control)'), `${selector} uses the themed control surface`);
  }
  // No rule that styles an input, select or textarea sets a text size below 16px.
  for (const rule of rules) {
    if (!rule.selectors.some(selector => /(^|[\s>])(input|select|textarea)\b/.test(selector))) continue;
    const size = rule.declarations['font-size'];
    if (!size) continue;
    const rem = size.startsWith('var(') ? Number(lightTokens.get(size.slice(4, -1)).replace('rem', '')) : size.endsWith('rem') ? Number(size.replace('rem', '')) : Number(size.replace('px', '')) / 16;
    assert.ok(rem >= 1, `${rule.selectors.join(', ')} sets ${size}`);
  }
});

test('selectors that the JavaScript and the markup rely on are still styled', () => {
  const classes = ['receipt-card', 'receipt-summary', 'summary-id', 'summary-store', 'summary-amount', 'summary-toggle', 'toggle-icon', 'receipt-content', 'receipt-fields', 'receipt-form-group', 'receipt-form-footer',
    'delete-receipt', 'restore-receipt', 'scan-label', 'scan-button', 'store-suggestions', 'store-suggestion', 'optimization-receipt-card', 'compact-edit', 'compact-restore', 'selected-badge',
    'quick-amount-row', 'quick-result', 'monthly-card', 'navigation-brand', 'brand-slash', 'account', 'mobile-topbar', 'user-email', 'theme-control', 'application-navigation', 'monthly-suggestions', 'workspace-tab', 'navigation-item', 'edit-modal', 'modal-card', 'receipt-status-badge', 'currency-input', 'optimization-search-wrap'];
  for (const name of classes) assert.ok(clean.includes(`.${name}`), `.${name} remains styled`);
  assert.match(clean, /\.quick-amount-row\.is-selected/);
  assert.match(clean, /\.quick-result\[aria-pressed="true"\]/);
  assert.match(clean, /\.optimization-receipt-card\.is-selected/);
  assert.match(clean, /\.receipt-card\.is-consumed/);
  assert.match(clean, /\.confirmation-modal\.is-danger/);
});

test('the sign-in card consumes shared tokens instead of fixed colours', () => {
  assert.doesNotMatch(withoutComments(authCss), /#[0-9a-fA-F]{3,6}\b/, 'auth.css has no hard-coded colours');
  assert.match(authCss, /var\(--surface\)/);
});

test('light and dark themes remain selectable through the same data-theme attribute', () => {
  assert.ok(tokenBlocks('dark').size > lightTokens.size - 20);
  assert.match(clean, /html\[data-theme="dark"\] select\s*\{\s*color-scheme:\s*dark;/);
  assert.match(clean, /html\[data-theme="light"\] select\s*\{\s*color-scheme:\s*light;/);
});
