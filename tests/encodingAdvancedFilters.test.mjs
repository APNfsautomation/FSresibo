// Issue #62: Encoding-only, collapsible search and advanced filters; no database or optimizer candidate mutations.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildOptimizationView, defaultEncodingFilterState, encodingFilterCount } from '../ui/receiptUi.js';
import { receiptFixture } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, store, amount, extras = {}) => ({
  dbId, store, amount, receiptDate: '2026-11-01', expenseAccount: 'Day to day', classification: 'Meals', ...extras
});
const rowsShown = fixture => fixture.rows().filter(row => !row.hidden).map(row => row.dataset.receiptDbId);
const change = async (input, value) => { input.value = value; await input.emit('change'); };
const search = async (fixture, value) => { fixture.elements.encodingSearch.value = value; await fixture.elements.encodingSearch.emit('input'); await new Promise(resolve => setTimeout(resolve, 155)); };

test('Encoding filter defaults, count and blank values are display-only', () => {
  assert.deepEqual(defaultEncodingFilterState(), { search: '', store: '', startDate: '', endDate: '', minAmount: '', maxAmount: '', expenseAccount: '', classification: '' });
  assert.equal(encodingFilterCount(defaultEncodingFilterState()), 0);
  assert.equal(encodingFilterCount({ ...defaultEncodingFilterState(), search: ' hi ', expenseAccount: 'Project Expense', maxAmount: ' ' }), 2);
});

test('shared Optimization view respects optional expense filters without changing default Optimization behavior', () => {
  const entries = [
    { receiptId: '1', index: 0, receipt: saved('a', 'A', 100), amount: 10000, date: '2026-11-01' },
    { receiptId: '2', index: 1, receipt: saved('b', 'B', 200, { classification: 'Others' }), amount: 20000, date: '2026-11-01' }
  ];
  const baseline = { status: 'available', sort: 'default' };
  assert.equal(buildOptimizationView(entries, baseline).visible.length, 2);
  assert.deepEqual(buildOptimizationView(entries, { ...baseline, classification: 'Meals' }).visible.map(row => row.receiptId), ['1']);
  assert.deepEqual(buildOptimizationView(entries, { ...baseline, expenseAccount: 'Project Expense' }).visible, []);
});

test('Encoding search is visible, debounced, does not alter editor rows or optimizer result count, and clears safely', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 'Alpha Shop', 100), saved('b', 'Beta Supplies', 200)] });
  const original = [...f.rows()];
  const optimizerBefore = f.elements.optimizationResultCount.textContent;
  assert.equal(f.elements.encodingMoreFilters.open, false);
  assert.equal(f.elements.encodingFilterToggleLabel.textContent, 'Show Filter Options');
  await search(f, 'beta');
  assert.deepEqual(rowsShown(f), ['b']);
  assert.deepEqual(f.rows(), original, 'filtering does not move/recreate any editor');
  assert.equal(f.elements.encodingResultCount.textContent, 'Showing 1 of 2 receipts');
  assert.equal(f.elements.encodingFilterStatus.textContent, '1 active filter');
  assert.equal(f.elements.encodingFilterActiveCount.textContent, ' (1 active)');
  assert.equal(f.elements.optimizationResultCount.textContent, optimizerBefore, 'optimizer display is unaffected');
  assert.deepEqual([f.calls.create.length, f.calls.update.length, f.calls.consume.length], [0, 0, 0]);
  await f.click(f.elements.clearEncodingSearch);
  assert.deepEqual(rowsShown(f), ['a', 'b']);
  assert.equal(f.elements.encodingSearch.value, '');
});

test('Store, dates, amount and both expense controls compose without changing stored values', async () => {
  const f = await receiptFixture({ loaded: [
    saved('a', 'Alpha', 150, { receiptDate: '2026-11-01', classification: 'Service Charge' }),
    saved('b', 'Alpha', 275, { receiptDate: '2026-11-03', expenseAccount: 'Project Expense', classification: 'Government Benefits' }),
    saved('c', 'Gamma', 900, { receiptDate: '2026-11-05', classification: 'Others' })
  ] });
  assert.ok(f.elements.encodingClassificationFilter.children.some(opt => opt.value === 'Service Charge'));
  assert.ok(f.elements.encodingClassificationFilter.children.some(opt => opt.value === 'Government Benefits'));
  await change(f.elements.encodingStoreFilter, 'alpha');
  await change(f.elements.encodingStartDate, '2026-11-02');
  await change(f.elements.encodingEndDate, '2026-11-05');
  await change(f.elements.encodingMinAmount, '200');
  await change(f.elements.encodingMaxAmount, '500');
  await change(f.elements.encodingExpenseAccountFilter, 'Project Expense');
  await change(f.elements.encodingClassificationFilter, 'Government Benefits');
  assert.deepEqual(rowsShown(f), ['b']);
  assert.equal(f.elements.encodingResultCount.textContent, 'Showing 1 of 3 receipts');
  assert.equal(f.elements.encodingFilterStatus.textContent, '7 active filters');
  assert.equal(f.elements.encodingFilterActiveCount.hidden, false);
  assert.deepEqual(f.rows().map(r => r.dataset.receiptDbId), ['a', 'b', 'c']);
  assert.deepEqual([f.calls.create.length, f.calls.update.length, f.calls.consume.length], [0, 0, 0]);
  await f.click(f.elements.clearEncodingFilters);
  assert.deepEqual(rowsShown(f), ['a', 'b', 'c']);
  assert.equal(f.elements.encodingFilterStatus.hidden, true);
  assert.equal(f.elements.encodingResultCount.textContent, 'Showing 3 of 3 receipts');
});

test('An actively edited receipt stays visible outside a new advanced filter until it is collapsed', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 'Alpha', 100), saved('b', 'Beta', 200)] });
  const row = f.rows()[0];
  row.open = true;
  await f.type(row, 'amount', '125');
  await change(f.elements.encodingStoreFilter, 'beta');
  assert.deepEqual(rowsShown(f), ['a', 'b'], 'active edit remains visible until it is released');
  assert.equal(row.part('.receipt-range-flag').textContent, 'Outside filters');
  assert.match(row.part('summary').getAttribute('aria-label'), /outside the current filters/, 'the screen-reader label names the real filtering reason');
  assert.match(f.elements.encodingFilterNoticeText.textContent, /outside the current filters/i);
  row.open = false;
  await row.emit('toggle');
  assert.deepEqual(rowsShown(f), ['b'], 'collapsing releases the presentation-only edit pin');
  assert.equal(row.part('.receipt-amount').value, '125', 'the typed unsaved value is preserved even when filtered out');
});

test('Clear filters resets the existing amount compartment but does not alter the shared Available / Consumed view', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 'Alpha', 180), saved('b', 'Used', 500, { status: 'consumed' })] });
  f.elements.receiptStatusFilter.value = 'consumed'; await f.elements.receiptStatusFilter.emit('change');
  f.elements.encodingAmountCompartment.value = 'below-200'; await f.elements.encodingAmountCompartment.emit('change');
  assert.deepEqual(rowsShown(f), []);
  assert.equal(f.elements.clearEncodingFilters.hidden, false);
  assert.equal(f.elements.encodingFilterStatus.textContent, '1 active filter', 'the existing amount compartment counts as an active filter');
  await f.click(f.elements.clearEncodingFilters);
  assert.equal(f.elements.encodingAmountCompartment.value, 'all');
  assert.equal(f.elements.receiptStatusFilter.value, 'consumed');
  assert.deepEqual(rowsShown(f), ['b']);
});

test('Invalid range is reported; filter view changes do not alter export state or receipt values', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 'Alpha', 100), saved('b', 'Beta', 200)] });
  await change(f.elements.encodingStartDate, '2026-12-01');
  await change(f.elements.encodingEndDate, '2026-11-01');
  assert.match(f.elements.encodingRangeValidation.textContent, /Start date must be on or before end date/);
  assert.equal(f.elements.encodingRangeValidation.hidden, false);
  assert.deepEqual(rowsShown(f), ['a', 'b'], 'invalid date range must not discard receipt rows');
  assert.equal(f.calls.download.length, 0);
  assert.equal(f.calls.snapshot.length, 0);
});

test('The native details panel exposes Show/Hide and keeps active filters when collapsed', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 'Alpha', 100), saved('b', 'Beta', 200)] });
  await change(f.elements.encodingStoreFilter, 'beta');
  f.elements.encodingMoreFilters.open = true; await f.elements.encodingMoreFilters.emit('toggle');
  assert.equal(f.elements.encodingFilterToggleLabel.textContent, 'Hide Filter Options');
  f.elements.encodingMoreFilters.open = false; await f.elements.encodingMoreFilters.emit('toggle');
  assert.equal(f.elements.encodingFilterToggleLabel.textContent, 'Show Filter Options');
  assert.equal(f.elements.encodingFilterActiveCount.textContent, ' (1 active)');
  assert.deepEqual(rowsShown(f), ['b'], 'collapsing only changes presentation, not filters');
});

test('Filters clear at sign-out and account changes; previous account search never appears in new session', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 'Alpha', 100), saved('b', 'Beta', 200)] });
  await search(f, 'alpha');
  f.elements.encodingMoreFilters.open = true;
  await f.ui.loadForUser({ id: 'user-2' });
  assert.equal(f.elements.encodingSearch.value, '');
  assert.equal(f.elements.encodingMoreFilters.open, false);
  assert.deepEqual(rowsShown(f), ['a', 'b']);
  await search(f, 'beta');
  f.ui.clearForLogout();
  assert.equal(f.elements.encodingSearch.value, '');
  assert.equal(f.elements.encodingMoreFilters.open, false);
  assert.equal(f.elements.encodingFilterStatus.hidden, true);
});

test('Markup and CSS keep disclosure collapsed, use responsive filter layout, and do not reorder editor DOM', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const section = html.slice(html.indexOf('id="encodingWorkspace"'), html.indexOf('id="optimizationWorkspace"'));
  for (const id of ['encodingSearch','encodingMoreFilters','encodingResultCount','encodingFilterActiveCount','encodingStoreFilter','encodingStartDate','encodingEndDate','encodingMinAmount','encodingMaxAmount','encodingExpenseAccountFilter','encodingClassificationFilter','clearEncodingFilters']) {
    assert.equal((section.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, id);
  }
  assert.match(section, /<details class="more-filters" id="encodingMoreFilters">/, 'native disclosure collapsed by default');
  assert.match(css, /\.optimization-toolbar, \.encoding-toolbar \{/);
  assert.match(css, /\.filter-fields \{ grid-template-columns: 1fr 1fr; \}/, 'phone layout is two columns');
  assert.equal(section.includes('id="encodingSort"'), false, 'sorting editor DOM is out of scope for the first, low-risk filter increment');
});
