// Issue #22 (CP10-C3E-4U01-A): per-receipt unsaved indicators (A), Select Shown that fills the remaining capacity up to 100 (B), and reachable Expand all / Collapse all (C).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, amount, store, extra = {}) => ({ dbId, amount, store, receiptDate: '2026-08-01', ...extra });
const flag = row => row.part('.receipt-unsaved-flag');
const kindOf = row => flag(row).hidden ? '' : flag(row).textContent;
const kinds = f => f.rows().map(kindOf);
const name = row => row.part('summary').getAttribute('aria-label');
const counter = f => f.elements.encodingUnsavedText.textContent;

// ---- A. per-receipt unsaved indicators ------------------------------------------------------------------------------------------------------
test('A1: a saved receipt shows no flag; editing it shows "Unsaved changes" on that receipt only, with a card class and an accessible name', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 200, 'Beta')] });
  assert.deepEqual(kinds(f), ['', '']);
  await f.type(f.rows()[1], 'amount', '250');
  assert.deepEqual(kinds(f), ['', 'Unsaved changes']);
  assert.equal(f.rows()[1].classList.contains('is-unsaved'), true); assert.equal(f.rows()[0].classList.contains('is-unsaved'), false);
  assert.match(name(f.rows()[1]), /unsaved changes/); assert.doesNotMatch(name(f.rows()[0]), /unsaved/);
  assert.equal(flag(f.rows()[1]).hidden, false, 'a flag in the summary is visible whether the card is expanded or collapsed');
});

test('A1: a new blank receipt has no flag; once something is entered it shows "New, unsaved"', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha')] });
  await f.click(f.elements.floatingAdd);
  const fresh = f.rows().at(-1);
  assert.equal(kindOf(fresh), '', 'blank');
  await f.type(fresh, 'store', 'New Store');
  assert.equal(kindOf(fresh), 'New, unsaved'); assert.equal(fresh.classList.contains('is-unsaved'), true);
  assert.match(name(fresh), /new, unsaved/);
  await f.type(fresh, 'store', '');
  assert.equal(kindOf(fresh), '', 'back to blank: no flag');
});

test('A2: reverting an edit clears the flag; saving clears it for persisted rows', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 200, 'Beta')] });
  await f.type(f.rows()[0], 'amount', '150'); assert.equal(kindOf(f.rows()[0]), 'Unsaved changes');
  await f.type(f.rows()[0], 'amount', '100'); assert.equal(kindOf(f.rows()[0]), '', 'typed back to the saved value');
  await f.type(f.rows()[0], 'store', 'Alpha 2'); await f.type(f.rows()[1], 'amount', '210');
  assert.equal(counter(f), '2 unsaved receipts');
  await f.click(f.elements.saveDraft);
  assert.deepEqual(kinds(f), ['', '']); assert.equal(f.elements.encodingUnsavedIndicator.hidden, true);
});

test('A2: after a partial save failure only the rows that were really saved lose the flag', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 200, 'Beta'), saved('c', 300, 'Gamma')] });
  for (const [index, amount] of [[0, '110'], [1, '210'], [2, '310']]) await f.type(f.rows()[index], 'amount', amount);
  f.fails.saveAfter = 1; // the first save succeeds, the second one fails
  await f.click(f.elements.saveDraft);
  assert.deepEqual(kinds(f), ['', 'Unsaved changes', 'Unsaved changes'], 'the saved row is clean; the others are still flagged and never presented as saved');
  assert.equal(counter(f), '2 unsaved receipts');
  assert.match(f.elements.encodingFeedback.textContent, /Could not save receipt changes/);
  f.fails.saveAfter = null; await f.click(f.elements.saveDraft);
  assert.deepEqual(kinds(f), ['', '', '']);
});

test('A2: a new receipt that is saved becomes a clean saved receipt', async () => {
  const f = await receiptFixture({ loaded: [] });
  await f.click(f.elements.floatingAdd); const fresh = f.rows()[0];
  await f.type(fresh, 'store', 'Fresh'); await f.type(fresh, 'amount', '75'); assert.equal(kindOf(fresh), 'New, unsaved');
  await f.click(f.elements.saveDraft);
  assert.equal(kindOf(fresh), ''); assert.equal(f.calls.create.length, 1);
});

test('A3: the global unsaved count always equals the number of flagged receipts, including new drafts', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 200, 'Beta')] });
  await f.type(f.rows()[0], 'invoice', 'X1');
  await f.click(f.elements.floatingAdd); await f.type(f.rows().at(-1), 'store', 'Draft');
  const flagged = kinds(f).filter(Boolean).length;
  assert.equal(flagged, 2); assert.equal(counter(f), '2 unsaved receipts');
  await f.click(f.elements.floatingAdd); // another blank one is not counted and not flagged
  assert.equal(kinds(f).filter(Boolean).length, 2); assert.equal(counter(f), '2 unsaved receipts');
});

test('A3/A4: the flag agrees with the export preflight: a change the export refuses is always flagged, even a whitespace-only one', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 200, 'Beta')] });
  f.elements.exportModeManual.checked = true; await f.elements.exportModeManual.emit('change');
  const box = store => f.cards().find(item => item.part('.compact-store').textContent === store).part('.manual-select');
  await box('Alpha').emit('change');
  await f.type(f.rows()[0], 'store', 'Alpha '); // only trailing whitespace changed
  assert.equal(kindOf(f.rows()[0]), 'Unsaved changes');
  await f.click(f.elements.manualExportSelected);
  assert.match(f.elements.manualFeedback.textContent, /Receipt 1 has unsaved changes/, 'the preflight blocks it for the same reason the card shows');
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
});

test('A4: Consumed receipts never show a false unsaved state, and the outside-range flag is separate from the unsaved flag', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('u', 70, 'Used', { status: 'consumed' })] });
  f.elements.receiptStatusFilter.value = 'all'; await f.elements.receiptStatusFilter.emit('change'); await settle();
  const used = f.rows().find(row => row.dataset.receiptDbId === 'u');
  assert.equal(kindOf(used), ''); assert.equal(used.classList.contains('is-unsaved'), false);
  f.elements.encodingAmountCompartment.value = 'below-200'; await f.elements.encodingAmountCompartment.emit('change');
  const alpha = f.rows().find(row => row.dataset.receiptDbId === 'a');
  alpha.open = true; await f.type(alpha, 'store', 'Alpha edited');
  assert.equal(alpha.classList.contains('is-outside-range'), false, 'an unsaved store edit alone does not make a receipt outside the range');
  assert.equal(kindOf(alpha), 'Unsaved changes');
  await f.type(alpha, 'amount', '300'); // the edit pin keeps it visible although 300 is outside "below 200"
  assert.equal(alpha.classList.contains('is-outside-range'), true); assert.equal(alpha.part('.receipt-range-flag').hidden, false);
  assert.equal(kindOf(alpha), 'Unsaved changes', 'both states can show at once, each with its own words');
  assert.match(name(alpha), /outside the selected amount range/); assert.match(name(alpha), /unsaved changes/);
});

// ---- B. Select Shown fills the remaining capacity ---------------------------------------------------------------------------------------------
const rid = n => `r${String(n).padStart(3, '0')}`;
const many = (count, extra = () => ({})) => Array.from({ length: count }, (_, i) => saved(`r${String(i + 1).padStart(3, '0')}`, i + 1, `Store ${String(i + 1).padStart(3, '0')}`, extra(i)));
const manualFixture = async loaded => { const f = await receiptFixture({ loaded }); f.elements.exportModeManual.checked = true; await f.elements.exportModeManual.emit('change'); return f; };
const stores = f => f.cards().map(item => item.part('.compact-store').textContent);
const box = (f, store) => f.cards().find(item => item.part('.compact-store').textContent === store).part('.manual-select');
const selectedStores = f => f.cards().filter(item => item.classList.contains('is-selected')).map(item => item.part('.compact-store').textContent);
const count = f => f.elements.manualSelectedCount.textContent;
const feedback = f => f.elements.manualFeedback.textContent;
const shown = f => f.click(f.elements.manualSelectShown);
const reviewOrder = async f => { await f.click(f.elements.manualExportSelected); const ids = f.elements.exportReviewList.children.map(item => item.dataset.receiptId); await f.click(f.elements.cancelExport); return ids; };
const sortBy = async (f, value) => { f.elements.optimizationSort.value = value; await f.elements.optimizationSort.emit('change'); await settle(); };

test('B2: Select Shown follows the current visible sort order, and 400 shown receipts add only the first 100', async () => {
  const f = await manualFixture(many(400));
  await sortBy(f, 'amount-desc');
  await shown(f);
  assert.equal(count(f), '100 of 100');
  const ids = await reviewOrder(f);
  assert.deepEqual(ids, Array.from({ length: 100 }, (_, i) => rid(400 - i)), 'the 100 highest amounts, highest first (the on-screen order)');
  assert.match(feedback(f), /^100 receipts added in the order shown\. The selection is now full at 100 of 100; 300 more shown receipts were not added\.$/);
});

test('B2: 25 already selected (some hidden) + many shown: adds the first 75 not already selected, in order, without reordering the earlier ones', async () => {
  const f = await manualFixture(many(400));
  for (let i = 1; i <= 25; i += 1) await box(f, `Store ${String(i).padStart(3, '0')}`).emit('change'); // Stores 001..025, in click order
  f.elements.optimizationMinAmount.value = '200'; await f.elements.optimizationMinAmount.emit('change'); await settle(); // hides the earlier ones
  assert.ok(!stores(f).includes('Store 001'), 'the first selections are hidden by the filter');
  await shown(f);
  assert.equal(count(f), '100 of 100');
  f.elements.optimizationMinAmount.value = ''; await f.elements.optimizationMinAmount.emit('change'); await settle();
  const ids = await reviewOrder(f);
  assert.deepEqual(ids.slice(0, 25), Array.from({ length: 25 }, (_, i) => rid(i + 1)), 'earlier (hidden) selections keep their positions');
  assert.deepEqual(ids.slice(25), Array.from({ length: 75 }, (_, i) => rid(200 + i)), 'then the next 75 shown receipts in order');
  assert.equal(new Set(ids).size, 100);
});

test('B2/B4: with 75 selected it adds the next 25; with fewer eligible than room it adds them all; at 100 it adds none and says the selection is full', async () => {
  const f = await manualFixture(many(400));
  f.elements.optimizationMaxAmount.value = '75'; await f.elements.optimizationMaxAmount.emit('change'); await settle();
  await shown(f); assert.equal(count(f), '75 of 100'); assert.match(feedback(f), /^75 receipts added in the order shown\. 75 of 100 selected\.$/);
  f.elements.optimizationMaxAmount.value = ''; await f.elements.optimizationMaxAmount.emit('change'); await settle();
  await shown(f); assert.equal(count(f), '100 of 100'); assert.match(feedback(f), /^25 receipts added in the order shown\. The selection is now full at 100 of 100; /);
  await shown(f); assert.equal(count(f), '100 of 100'); assert.equal(feedback(f), 'The selection is full (100 of 100). Deselect a receipt to make room before adding more.');
});

test('B3: at 100/100 unselected controls cannot add, selected ones can deselect and re-open a slot, and a forged event is refused', async () => {
  const f = await manualFixture(many(120));
  await shown(f); assert.equal(count(f), '100 of 100');
  const unselected = box(f, 'Store 120'); const selectedBox = box(f, 'Store 001');
  assert.equal(unselected.disabled, true); assert.match(unselected.getAttribute('aria-label'), /limit of 100 receipts is reached/);
  assert.equal(selectedBox.disabled, false, 'selected controls stay usable');
  await unselected.emit('change'); assert.equal(count(f), '100 of 100', 'a forged change event cannot exceed 100');
  await selectedBox.emit('change'); assert.equal(count(f), '99 of 100');
  assert.equal(box(f, 'Store 120').disabled, false, 'a slot is open again');
  await box(f, 'Store 120').emit('change'); assert.equal(count(f), '100 of 100'); assert.ok(selectedStores(f).includes('Store 120'));
  assert.equal(box(f, 'Store 119').disabled, true);
});

test('B1: nothing exceeds 100 unique saved Available ids: not by sorting, filtering or repeated bulk actions', async () => {
  const f = await manualFixture(many(250));
  for (const sort of ['amount-asc', 'store-desc', 'default']) { await sortBy(f, sort); await shown(f); assert.ok(Number(count(f).split(' ')[0]) <= 100, sort); }
  f.elements.optimizationMinAmount.value = '100'; await f.elements.optimizationMinAmount.emit('change'); await settle(); await shown(f);
  const ids = await reviewOrder(f);
  assert.equal(ids.length, 100); assert.equal(new Set(ids).size, 100);
});

test('B5: 400 receipts export in four successive batches of 100, each Select Shown picking the next 100 Available and consuming exactly those ids', async () => {
  const f = await manualFixture(many(400));
  const consumedSoFar = new Set();
  for (let batch = 0; batch < 4; batch += 1) {
    await shown(f); assert.equal(count(f), '100 of 100', `batch ${batch + 1}`);
    await f.click(f.elements.manualExportSelected); await f.click(f.elements.confirmExport);
    const ids = f.calls.consume.at(-1);
    assert.equal(ids.length, 100); assert.deepEqual(ids, Array.from({ length: 100 }, (_, i) => `r${String(batch * 100 + i + 1).padStart(3, '0')}`), 'exactly the next 100 in the shown order');
    ids.forEach(id => { assert.ok(!consumedSoFar.has(id)); consumedSoFar.add(id); });
    assert.equal(count(f), '0 of 100', 'the finished selection is cleared');
  }
  assert.equal(consumedSoFar.size, 400);
  assert.equal([...f.db.values()].filter(row => row.status === 'consumed').length, 400);
  assert.equal(f.elements.manualSelectShown.textContent, 'Select shown (0)', 'nothing Available is left to pick');
});

test('B5: Select Shown never selects Consumed, unsaved or known-missing receipts, and Best Match is unaffected', async () => {
  const f = await manualFixture([...many(5), saved('c', 9, 'Used', { status: 'consumed' })]);
  await shown(f); assert.equal(count(f), '5 of 100');
  f.elements.exportModeBestMatch.checked = true; f.elements.exportModeManual.checked = false; await f.elements.exportModeBestMatch.emit('change');
  f.elements.target.value = '3'; await f.click(f.elements.calculate);
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (1)', 'Best Match still runs on its own');
  f.elements.exportModeManual.checked = true; await f.elements.exportModeManual.emit('change');
  assert.equal(count(f), '5 of 100', 'the manual selection is untouched');
});

// ---- C. reachable Expand all / Collapse all ---------------------------------------------------------------------------------------------------
test('C1/C3: the sticky-bar buttons use the existing handlers and only affect the receipts that are currently visible', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 250, 'Beta'), saved('u', 70, 'Used', { status: 'consumed' })] });
  const [a, b, used] = f.rows();
  assert.equal(used.hidden, true, 'the Consumed receipt is hidden by the Available view');
  await f.elements.barExpandAllReceipts.emit('click');
  assert.deepEqual([a.open, b.open, used.open], [true, true, false], 'hidden rows are unchanged');
  await f.elements.barCollapseAllReceipts.emit('click');
  assert.deepEqual([a.open, b.open, used.open], [false, false, false]);
  f.elements.encodingAmountCompartment.value = '200-299'; await f.elements.encodingAmountCompartment.emit('change');
  assert.equal(a.hidden, true);
  await f.elements.barExpandAllReceipts.emit('click');
  assert.deepEqual([a.open, b.open], [false, true], 'receipts hidden by the amount range are untouched');
});

test('C1: header and bar buttons are the same actions: both end in identical state, with no separate state', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 250, 'Beta')] });
  await f.elements.expandAllReceipts.emit('click'); const viaHeader = f.rows().map(row => row.open);
  await f.elements.collapseAllReceipts.emit('click'); await f.elements.barExpandAllReceipts.emit('click');
  assert.deepEqual(f.rows().map(row => row.open), viaHeader);
  await f.elements.barCollapseAllReceipts.emit('click'); assert.deepEqual(f.rows().map(row => row.open), [false, false]);
});

const html = (await readFile(new URL('../index.html', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const css = (await readFile(new URL('../styles.css', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const bar = html.slice(html.indexOf('id="encodingActions"'), html.indexOf('id="encodingFeedback"'));

test('C2/C4: the bar carries two labelled real buttons between the unsaved status and Add receipt; the phone shows icons only, with 44px targets', () => {
  assert.match(bar, /<span class="bar-tools" role="group" aria-label="Expand or collapse the shown receipts">/);
  assert.match(bar, /id="barExpandAllReceipts" type="button" aria-label="Expand all shown receipts"/);
  assert.match(bar, /id="barCollapseAllReceipts" type="button" aria-label="Collapse all shown receipts"/);
  assert.ok(bar.indexOf('encodingUnsavedIndicator') < bar.indexOf('barExpandAllReceipts') && bar.indexOf('barCollapseAllReceipts') < bar.indexOf('id="floatingAddReceipt"'));
  assert.match(css, /#encodingActions \.bar-tool \{ flex: 0 0 44px; width: 44px;/);
  assert.match(css, /#encodingActions \.bar-tool-text \{ display: none; \}/);
  assert.equal((html.match(/id="barExpandAllReceipts"/g) || []).length, 1);
  assert.equal((html.match(/id="expandAllReceipts"/g) || []).length, 1, 'the list-header buttons remain');
});

test('A1/C4: the unsaved flag is text in the card summary, themed with the warning tokens (light and dark), and the card gets the same accent as Monthly Filing', () => {
  assert.match(html, /<span class="receipt-unsaved-flag" hidden><\/span>/);
  assert.match(css, /\.receipt-unsaved-flag \{[^}]*var\(--warning-border\)[^}]*var\(--warning-soft\)[^}]*var\(--warning\)/);
  assert.match(css, /\.encoding-list \.receipt-card\.is-unsaved, \.encoding-list \.receipt-card\.is-unsaved\[open\] \{ box-shadow: inset 4px 0 0 var\(--warning\); \}/);
  assert.match(css, /\.monthly-card\.is-unsaved \{ box-shadow: inset 4px 0 0 var\(--warning\); \}/);
});
