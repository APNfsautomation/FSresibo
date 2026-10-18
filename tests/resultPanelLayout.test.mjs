// C3E2-UI-01: warnings inside the recommendation panel must not resize the summary cards.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = (await readFile(new URL('../styles.css', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const rule = selector => css.match(new RegExp(`(?:^|\n)${selector.replace(/[.*+?^${}()|[\]\>]/g, '\$&')} \{([^}]*)\}`))?.[1] ?? '';

test('the panel is still an auto + flexible two-column grid, and the summary keeps its explicit placement (root cause: an unplaced child widens the auto column)', () => {
  assert.match(rule('.result-panel'), /grid-template-columns: auto minmax\(0, 1fr\)/);
  assert.match(rule('.optimization-result-summary'), /grid-column: 2; grid-row: 1 \/ 5; display: grid; grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
});

test('the warning and the Go to Encoding action are placed across the whole panel, so they cannot feed the auto-sized column', () => {
  const placed = rule('.result-panel > .unsaved-values-notice, .result-panel > .export-go-encoding');
  assert.match(placed, /grid-column: 1 \/ -1/); assert.match(placed, /min-width: 0/); assert.match(placed, /max-width: 100%/);
  assert.match(rule('.result-panel > .unsaved-values-notice'), /overflow-wrap: anywhere/, 'a long unbroken word cannot overflow the panel');
  assert.match(rule('.result-panel > .export-go-encoding'), /justify-self: start/, 'the button keeps its natural width');
});

test('both elements are direct children of the panel (so the placement rule applies) and come before the summary and the details', () => {
  const panel = html.slice(html.indexOf('class="panel result-panel"'), html.indexOf('id="adminContent"'));
  for (const id of ['optimizationUnsavedNotice', 'exportGoToEncoding']) assert.ok(panel.includes(`id="${id}"`), `${id} is inside the recommendation panel`);
  assert.match(panel, /<p id="optimizationUnsavedNotice" class="unsaved-values-notice"/);
  assert.match(panel, /<button class="secondary export-go-encoding" id="exportGoToEncoding"/);
  assert.ok(panel.indexOf('id="exportGoToEncoding"') < panel.indexOf('id="optimizationResultSummary"'));
});

test('the phone layout still stacks the panel in one column, where the full-width placement is harmless', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 640px) {\n  .receipts-bar'));
  assert.match(phone, /\.result-panel \{ grid-template-columns: 1fr; \}/);
  assert.match(phone, /\.optimization-result-summary \{ grid-column: 1; grid-row: auto; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('the notice uses theme tokens only (light and dark follow them)', () => {
  const notice = rule('.unsaved-values-notice');
  assert.ok(notice.length > 0);
  assert.doesNotMatch(notice, /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(/);
  for (const token of ['--warning-soft', '--warning-border', '--warning', '--text']) assert.match(notice, new RegExp(`var[(]${token}[)]`));
});
