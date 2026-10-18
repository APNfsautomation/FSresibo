// C3E2-UI-01 / UI-02: nothing inside the recommendation panel may resize the summary cards.
// Root cause of both reports: the headline column was `auto`, so its width followed the longest text placed in it (the export message in #difference, then the
// unsaved-values warning). These tests protect the constraints that make the layout independent of that content. The rendered measurements are in the review report.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = (await readFile(new URL('../styles.css', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const rule = selector => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';
const declaration = (selector, property) => rule(selector).match(new RegExp(`(?:^|;|\\s)${property}: ([^;]+);`))?.[1].trim() ?? '';

test('the two panel columns are sized independently of their content: a fixed-range headline column and a flexible summary column, never auto or max-content', () => {
  const columns = declaration('.result-panel', 'grid-template-columns');
  assert.equal(columns, 'minmax(220px, 300px) minmax(0, 1fr)');
  assert.doesNotMatch(columns, /\bauto\b|max-content|min-content|fit-content/, 'no track may be sized by what is inside it');
  const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  .receipts-bar'));
  assert.match(phone, /\.result-panel \{ grid-template-columns: 1fr; \}/, 'the phone layout stays a single column');
});

test('the headline items stay in the first column and may shrink; the explanation / export message spans the whole panel and wraps', () => {
  const headline = rule('.result-panel > .result-label, .result-panel > h2, .result-panel > .result-amount');
  assert.match(headline, /grid-column: 1;/); assert.match(headline, /min-width: 0/);
  const difference = rule('.result-panel > .difference');
  assert.match(difference, /grid-column: 1 \/ -1/, 'a long export message gets the full panel width instead of a share of one column');
  assert.match(difference, /min-width: 0/); assert.match(difference, /overflow-wrap: anywhere/);
});

test('the five summary cards adapt: they wrap into rows (for example 3 + 2) instead of shrinking, and no breakpoint forces a fixed number of columns on desktop', () => {
  const summary = rule('.optimization-result-summary');
  assert.match(summary, /grid-column: 2; grid-row: 1 \/ 4;/, 'explicit placement beside the headline rows');
  assert.equal(declaration('.optimization-result-summary', 'grid-template-columns'), 'repeat(auto-fit, minmax(7rem, 1fr))');
  assert.doesNotMatch(summary, /repeat\(5,/, 'five forced columns are what made the cards collapse');
  const toTablet = css.slice(css.indexOf('@media (max-width: 1100px) {'), css.indexOf('@media (max-width: 1100px) {') + 900);
  assert.doesNotMatch(toTablet.slice(0, toTablet.indexOf('\n}\n')), /optimization-result-summary/, 'the 1100px rule no longer overrides the adaptive columns');
  const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  .receipts-bar'));
  assert.match(phone, /\.optimization-result-summary \{ grid-column: 1; grid-row: auto; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('the unsaved-values warning and Go to Encoding span the whole panel too, so they cannot feed any track', () => {
  const placed = rule('.result-panel > .unsaved-values-notice, .result-panel > .export-go-encoding');
  assert.match(placed, /grid-column: 1 \/ -1/); assert.match(placed, /min-width: 0/); assert.match(placed, /max-width: 100%/);
  assert.match(rule('.result-panel > .unsaved-values-notice'), /overflow-wrap: anywhere/);
  assert.match(rule('.result-panel > .export-go-encoding'), /justify-self: start/, 'the button keeps its natural width and does not stretch');
});

test('every long-text child of the panel is explicitly placed on the full width: the combined state (long message + warning + button) has no unplaced item', () => {
  const panel = html.slice(html.indexOf('class="panel result-panel"'), html.indexOf('id="adminContent"'));
  const children = [...panel.matchAll(/<(p|h2|div|dl|button|details)\b[^>]*?(?:id="([^"]+)")?[^>]*>/g)].map(match => match[0]);
  assert.ok(panel.includes('id="difference"') && panel.includes('id="optimizationUnsavedNotice"') && panel.includes('id="exportGoToEncoding"') && children.length > 5);
  assert.ok(panel.indexOf('id="difference"') < panel.indexOf('id="optimizationUnsavedNotice"') && panel.indexOf('id="optimizationUnsavedNotice"') < panel.indexOf('id="exportGoToEncoding"') && panel.indexOf('id="exportGoToEncoding"') < panel.indexOf('id="optimizationResultSummary"'));
  assert.match(panel, /<p id="difference" class="difference">/); assert.match(panel, /<p id="optimizationUnsavedNotice" class="unsaved-values-notice"/);
  assert.match(panel, /<button class="secondary export-go-encoding" id="exportGoToEncoding"/);
  assert.match(css, /\.kept-details, \.admin \{ grid-column: 1 \/ -1;/, 'the details sections already span the panel');
});

test('the summary cards keep readable values: values may wrap inside a card but never overflow it', () => {
  assert.match(rule('.optimization-result-summary dd'), /overflow-wrap: anywhere/);
  assert.match(rule('.optimization-result-summary div'), /padding: var\(--space-2\) var\(--space-3\)/);
  assert.match(rule('.optimization-result-summary'), /gap: var\(--space-2\)/);
});

test('the notice uses theme tokens only (light and dark follow them)', () => {
  const notice = rule('.unsaved-values-notice');
  assert.ok(notice.length > 0);
  assert.doesNotMatch(notice, /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(/);
  for (const token of ['--warning-soft', '--warning-border', '--warning', '--text']) assert.match(notice, new RegExp(`var[(]${token}[)]`));
});
