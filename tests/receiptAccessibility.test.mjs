import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { makeTemplateIdsUnique, receiptSummaryAccessibleName } from '../ui/receiptAccessibility.js';

test('summary names carry identity, store, amount and action so every receipt is distinguishable', () => {
  assert.equal(receiptSummaryAccessibleName({ id: '7', store: 'Mercury Drug', amountCents: 125000, open: false }), 'Receipt 7, Mercury Drug, 1,250.00 pesos, show details');
  assert.equal(receiptSummaryAccessibleName({ id: '7', store: 'Mercury Drug', amountCents: 125050, open: true }), 'Receipt 7, Mercury Drug, 1,250.50 pesos, collapse details');
  const names = [1, 2, 3, 5, 6].map(id => receiptSummaryAccessibleName({ id: String(id), store: 'Same Store', amountCents: 5000 }));
  assert.equal(new Set(names).size, names.length, 'the receipt identity keeps equal receipts distinguishable');
});

test('summary names stay honest when details are missing and show status', () => {
  assert.equal(receiptSummaryAccessibleName({ id: '3', store: '   ', amountCents: null }), 'Receipt 3, no store name, show details');
  assert.equal(receiptSummaryAccessibleName({ id: '3', store: 'A', amountCents: 0 }), 'Receipt 3, A, 0.00 pesos, show details');
  assert.equal(receiptSummaryAccessibleName({ id: '4', store: 'Jollibee', amountCents: 7525, status: 'consumed' }), 'Receipt 4, Jollibee, 75.25 pesos, consumed, show details');
  assert.doesNotMatch(receiptSummaryAccessibleName({ id: '1', store: 'X', amountCents: 100 }), /consumed/);
});

test('summary names use the stable receipt id, so filtering never renumbers a receipt', () => {
  const visibleAfterFilter = [{ id: '5', store: 'National Book Store' }, { id: '10', store: 'Ace Hardware' }];
  const names = visibleAfterFilter.map(receipt => receiptSummaryAccessibleName({ ...receipt, amountCents: 1000 }));
  assert.match(names[0], /^Receipt 5,/);
  assert.match(names[1], /^Receipt 10,/);
});

// A tiny element tree: ids, aria references, and querySelectorAll over the two attribute selectors the helper uses.
const node = (attributes = {}, children = []) => {
  const element = { attributes: { ...attributes }, children,
    get id() { return this.attributes.id; }, set id(value) { this.attributes.id = value; },
    getAttribute(name) { return this.attributes[name] ?? null; }, setAttribute(name, value) { this.attributes[name] = value; },
    all() { return this.children.flatMap(child => [child, ...child.all()]); },
    querySelectorAll(selector) { const attribute = selector.match(/^\[(.+)\]$/)[1]; return this.all().filter(candidate => attribute in candidate.attributes); } };
  return element;
};
const receiptClone = () => node({}, [
  node({ 'aria-labelledby': 'receipt-details-title' }, [node({ id: 'receipt-details-title' })]),
  node({ 'aria-labelledby': 'store-details-title' }, [node({ id: 'store-details-title' })])
]);

test('cloned template ids become unique per receipt and their aria references follow', () => {
  const first = receiptClone();
  const second = receiptClone();
  makeTemplateIdsUnique(first, 'receipt-1');
  makeTemplateIdsUnique(second, 'receipt-2');
  const ids = [...first.all(), ...second.all()].filter(element => element.id).map(element => element.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate ids across rendered receipts');
  assert.deepEqual(first.all().filter(element => element.getAttribute('aria-labelledby')).map(element => element.getAttribute('aria-labelledby')), ['receipt-details-title-receipt-1', 'store-details-title-receipt-1']);
  first.all().filter(element => element.getAttribute('aria-labelledby')).forEach(element => assert.ok(first.all().some(candidate => candidate.id === element.getAttribute('aria-labelledby')), 'each reference still points at an existing id'));
});

test('references to ids outside the cloned subtree are left untouched', () => {
  const clone = node({}, [node({ 'aria-describedby': 'outside-help inner-help' }, [node({ id: 'inner-help' })])]);
  makeTemplateIdsUnique(clone, 'x');
  assert.equal(clone.children[0].getAttribute('aria-describedby'), 'outside-help inner-help-x');
});

test('the receipt template no longer ships a static generic summary label', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const summary = html.match(/<summary class="receipt-summary"[^>]*>/)?.[0] ?? '';
  assert.ok(summary, 'receipt summary markup exists');
  assert.doesNotMatch(summary, /aria-label=/, 'accessible names are generated per receipt');
});

test('every id used by the receipt template is rewritten per clone, never rendered twice', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const template = html.match(/<template id="receiptTemplate">([\s\S]*?)<\/template>/)[1];
  const templateIds = [...template.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const labelledBy = [...template.matchAll(/aria-labelledby="([^"]+)"/g)].map(match => match[1]);
  assert.ok(templateIds.length > 0 && labelledBy.every(reference => templateIds.includes(reference)));
  const rendered = [1, 2, 3].flatMap(index => { const clone = node({}, templateIds.map(id => node({ id }))); makeTemplateIdsUnique(clone, `receipt-${index}`); return clone.all().map(element => element.id); });
  assert.equal(new Set(rendered).size, rendered.length);
  const source = await readFile(new URL('../ui/receiptUi.js', import.meta.url), 'utf8');
  assert.match(source, /cloneNode\(true\);\r?\n\s*makeTemplateIdsUnique\(row, `receipt-\$\{\+\+receiptDomSequence\}`\)/, 'each cloned receipt row gets its own id suffix');
});

test('receipt summaries refresh their accessible name on edits, status changes and expansion', async () => {
  const source = await readFile(new URL('../ui/receiptUi.js', import.meta.url), 'utf8');
  const refreshCalls = source.match(/refreshSummaryAccessibleName\(row\)/g) ?? [];
  assert.ok(refreshCalls.length >= 3, 'toggle, summary values and status state each refresh the name');
  assert.match(source, /const refreshToggle = row => \{[\s\S]*?refreshSummaryAccessibleName\(row\);/);
  assert.match(source, /const refreshSummary = row => \{[\s\S]*?refreshSummaryAccessibleName\(row\);/);
  assert.match(source, /const applyReceiptStatusState = row => \{[\s\S]*?refreshSummaryAccessibleName\(row\);/);
});
