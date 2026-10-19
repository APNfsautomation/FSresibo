// CP10-C3E-4: Manual Selection and its export, driven through the real receipt UI against an in-memory receipts database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildExpenseDetailedReportRows } from '../services/exportService.js';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, amount, store, extra = {}) => ({ dbId, amount, store, receiptDate: '2026-08-01', ...extra });
const six = () => [saved('r1', 100, 'Store A'), saved('r2', 200, 'Store B', { receiptDate: '2026-08-02' }), saved('r3', 300, 'Store C', { receiptDate: '2026-08-03' }), saved('r4', 400, 'Store D', { receiptDate: '2026-08-04' }), saved('r5', 500, 'Store E', { receiptDate: '2026-08-05' }), saved('r6', 600, 'Store F', { receiptDate: '2026-08-06' })];
const toManual = async f => { f.elements.exportModeManual.checked = true; f.elements.exportModeBestMatch.checked = false; await f.elements.exportModeManual.emit('change'); return f; };
const toBest = async f => { f.elements.exportModeBestMatch.checked = true; f.elements.exportModeManual.checked = false; await f.elements.exportModeBestMatch.emit('change'); return f; };
const manualFixture = async options => toManual(await receiptFixture(options));
const card = (f, store) => f.cards().find(item => item.part('.compact-store').textContent === store);
const pick = (f, store) => card(f, store).part('.manual-select').emit('change');
const picks = async (f, ...stores) => { for (const store of stores) await pick(f, store); };
const selectedStores = f => f.cards().filter(item => item.classList.contains('is-selected')).map(item => item.part('.compact-store').textContent);
const review = f => f.click(f.elements.manualExportSelected);
const items = f => f.elements.exportReviewList.children;
const order = f => items(f).map(item => item.dataset.receiptId);
const storesInReview = f => items(f).map(item => item.children[1].children[0].textContent.split(' · ')[1]);
const dialogOpen = f => f.elements.exportConfirmModal.hidden === false;
const confirm = f => f.click(f.elements.confirmExport);
const feedback = f => f.elements.manualFeedback.textContent;
const summary = f => ({ count: f.elements.manualSelectedCount.textContent, total: f.elements.manualSelectedTotal.textContent.replace(/\s/g, ''), noAmount: f.elements.manualNoAmountGroup.hidden ? '' : f.elements.manualNoAmount.textContent, hidden: f.elements.manualHiddenGroup.hidden ? '' : f.elements.manualHidden.textContent });
const otherSession = (f, id, changes) => f.db.set(id, { ...f.db.get(id), ...changes, updatedAt: f.stamp() });
const setFilter = async (f, name, value) => { f.elements[name].value = value; await f.elements[name].emit('change'); await settle(); };
const ack = async f => { f.elements.exportReviewAckInput.checked = true; await f.elements.exportReviewAckInput.emit('change'); };
const bestMatch = async (f, target) => { f.elements.target.value = target; await f.click(f.elements.calculate); };

// ---- A. mode management ----------------------------------------------------------------------------------------------------------------------
test('A: Best Match is the default; Manual Selection shows its own panel and heading; switching back restores the recommendation interface', async () => {
  const f = await receiptFixture({ loaded: six() });
  assert.deepEqual([f.elements.exportModeBestMatch.checked, f.elements.exportModeManual.checked], [true, false]);
  assert.equal(f.elements.manualPanel.hidden, true); assert.equal(f.elements.bestMatchCard.hidden, false); assert.equal(f.elements.bestMatchResult.hidden, false);
  await toManual(f);
  assert.equal(f.elements.manualPanel.hidden, false); assert.equal(f.elements.bestMatchCard.hidden, true); assert.equal(f.elements.bestMatchResult.hidden, true);
  assert.equal(f.elements.optimizationHeading.textContent, 'My Receipt Manual Selection');
  await toBest(f);
  assert.equal(f.elements.manualPanel.hidden, true); assert.equal(f.elements.bestMatchCard.hidden, false); assert.equal(f.elements.optimizationHeading.textContent, 'My Receipt Optimization');
});

test('A: the optimizer is never run by manual selection, and no target or strategy is needed', async () => {
  const f = await manualFixture({ loaded: six() });
  f.elements.target.value = ''; await picks(f, 'Store A', 'Store C');
  assert.equal(f.elements.resultTitle.textContent, 'Add receipts to begin', 'no recommendation was produced');
  await review(f); assert.equal(dialogOpen(f), true, 'Review & Arrange opens with an empty target');
});

test('A: the two selections are isolated and both survive switching modes, navigation and the Encoding workspace', async () => {
  const f = await receiptFixture({ loaded: six() });
  await bestMatch(f, '600'); // closest: Store F alone (600)
  const bestLabel = f.elements.exportSelected.textContent; const bestCards = selectedStores(f);
  assert.equal(bestLabel, 'Export Selected (1)'); assert.deepEqual(bestCards, ['Store F']);
  await toManual(f); assert.deepEqual(selectedStores(f), [], 'the optimizer result is not shown as a manual selection');
  await picks(f, 'Store D', 'Store E');
  assert.equal(summary(f).count, '2 of 100');
  await toBest(f);
  assert.equal(f.elements.exportSelected.textContent, bestLabel); assert.deepEqual(selectedStores(f), bestCards, 'the original optimizer selection is intact');
  f.ui.setWorkspace('encoding'); f.ui.setWorkspace('optimization');
  await toManual(f); assert.deepEqual(selectedStores(f), ['Store D', 'Store E'], 'the manual selection remained selected'); assert.equal(f.elements.manualExportSelected.textContent, 'Export Selected (2)');
  await toBest(f); assert.deepEqual(selectedStores(f), bestCards);
});

test('A: logout, a reload (new session) and another user all start with nothing selected', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store A', 'Store B');
  f.ui.clearForLogout();
  assert.equal(f.elements.manualExportSelected.textContent, 'Export Selected (0)'); assert.equal(f.elements.manualPanel.hidden, true, 'back to Best Match');
  await f.ui.loadForUser({ id: 'user-1' }); await toManual(f);
  assert.equal(summary(f).count, '0 of 100');
  await picks(f, 'Store C'); await f.ui.loadForUser({ id: 'user-2' });
  assert.equal(f.elements.manualPanel.hidden, true); await toManual(f); assert.equal(summary(f).count, '0 of 100', 'a different account never inherits a selection');
  const fresh = await manualFixture({ loaded: six() }); assert.equal(summary(fresh).count, '0 of 100', 'a reload starts empty');
});

test('the manual selection is never written to browser storage or the database', async () => {
  const { storage } = await import('./helpers/receiptUiFixture.mjs');
  const f = await manualFixture({ loaded: six() }); await picks(f, 'Store A', 'Store B');
  assert.equal([...storage.keys()].some(key => /manual/i.test(key)) || [...storage.values()].some(value => /"?r[12]"?/.test(String(value)) && /manual/i.test(String(value))), false);
  assert.deepEqual([f.calls.create.length, f.calls.update.length], [0, 0]);
  const source = await readFile(new URL('../domain/manualSelection.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|supabase|fetch\(/);
});

// ---- B. selection -----------------------------------------------------------------------------------------------------------------------------
test('B: picking, deselecting and re-picking; the order is the click order and re-picking moves a receipt to the end', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store D', 'Store B', 'Store A', 'Store C');
  assert.deepEqual(selectedStores(f), ['Store A', 'Store B', 'Store C', 'Store D'].filter(() => true), 'all four highlighted');
  assert.deepEqual(card(f, 'Store D').part('.selected-badge').textContent, 'Selected · 1');
  assert.equal(card(f, 'Store C').part('.selected-badge').textContent, 'Selected · 4', 'the badge shows the position in the export order, not only colour');
  await pick(f, 'Store B'); assert.deepEqual(selectedStores(f).includes('Store B'), false); assert.equal(summary(f).count, '3 of 100');
  await pick(f, 'Store B');
  await review(f); assert.deepEqual(storesInReview(f), ['Store D', 'Store A', 'Store C', 'Store B'], 'B was re-picked, so it is last');
});

test('B: the checkboxes are labelled, keyboard operable (native checkboxes), keep focus after toggling, and say why a receipt cannot be picked', async () => {
  const f = await manualFixture({ loaded: [...six(), saved('c1', 50, 'Consumed Store', { status: 'consumed' })] });
  await setFilter(f, 'receiptStatusFilter', 'all');
  assert.equal(card(f, 'Store A').part('.manual-select').getAttribute('aria-label'), 'Select Receipt 1, Store A');
  assert.equal(card(f, 'Consumed Store').part('.manual-select').disabled, true);
  assert.match(card(f, 'Consumed Store').part('.manual-select').getAttribute('aria-label'), /Receipt 7 is Consumed and cannot be selected/);
  await pick(f, 'Store A');
  assert.match(feedback(f), /^Receipt 1 selected: number 1 in the export order, 1 of 100 selected\.$/);
  assert.equal(f.focusLog.at(-1), card(f, 'Store A').part('.manual-select'), 'the list was rebuilt but focus is back on the same receipt');
  assert.equal(card(f, 'Store A').part('.manual-select').checked, true);
});

test('B: Consumed receipts and unsaved drafts cannot be selected', async () => {
  const f = await manualFixture({ loaded: [saved('r1', 100, 'Store A'), saved('c1', 50, 'Consumed Store', { status: 'consumed' })] });
  await f.click(f.elements.floatingAdd); const draft = f.rows().at(-1); await f.type(draft, 'store', 'Draft Store'); await f.type(draft, 'amount', '70');
  await setFilter(f, 'receiptStatusFilter', 'all');
  assert.equal(card(f, 'Draft Store').part('.manual-select').disabled, true);
  assert.match(card(f, 'Draft Store').part('.manual-select').getAttribute('aria-label'), /is not saved yet\. Save it before selecting it/);
  await pick(f, 'Draft Store'); await pick(f, 'Consumed Store');
  assert.equal(summary(f).count, '0 of 100', 'forcing a change event on a disabled control selects nothing');
});

test('B: the limit is 100: the 100th is accepted, the 101st is rejected with a clear message and nothing is removed or replaced', async () => {
  const loaded = Array.from({ length: 105 }, (_, i) => saved(`r${i + 1}`, i + 1, `S${String(i + 1).padStart(3, '0')}`));
  const f = await manualFixture({ loaded });
  for (let i = 1; i <= 100; i += 1) await pick(f, `S${String(i).padStart(3, '0')}`);
  assert.equal(summary(f).count, '100 of 100');
  await pick(f, 'S101');
  assert.match(feedback(f), /^You can select up to 100 receipts for one export\. Deselect a receipt before adding another\.$/);
  assert.equal(summary(f).count, '100 of 100'); assert.equal(card(f, 'S101').part('.manual-select').checked, false, 'the rejected receipt is not shown as selected');
  assert.equal(card(f, 'S001').part('.manual-select').checked, true, 'nothing was silently removed');
  await pick(f, 'S050'); assert.equal(summary(f).count, '99 of 100'); await pick(f, 'S101'); assert.equal(summary(f).count, '100 of 100');
});

test('B: Select shown selects the eligible receipts in view, keeps hidden selections, and never duplicates', async () => {
  const f = await manualFixture({ loaded: [...six(), saved('c1', 50, 'Consumed Store', { status: 'consumed' })] });
  await pick(f, 'Store F');
  await setFilter(f, 'optimizationStartDate', '2026-08-03'); await setFilter(f, 'optimizationEndDate', '2026-08-04'); // shows Store C and Store D
  assert.equal(f.elements.manualSelectShown.textContent, 'Select shown (2)');
  await f.click(f.elements.manualSelectShown);
  assert.match(feedback(f), /^2 receipts added to the selection\. 3 of 100 selected\.$/);
  await setFilter(f, 'optimizationStartDate', ''); await setFilter(f, 'optimizationEndDate', '');
  await review(f); assert.deepEqual(storesInReview(f), ['Store F', 'Store C', 'Store D'], 'the earlier selection kept its place; the shown ones follow in the order shown');
  await f.click(f.elements.cancelExport);
  await f.click(f.elements.manualSelectShown); await f.click(f.elements.manualSelectShown);
  assert.equal(summary(f).count, '6 of 100', 'repeating it adds only what is new, and Consumed receipts are excluded');
  await review(f); assert.equal(new Set(order(f)).size, 6);
});

test('B: Select shown that would pass the limit selects nothing at all and explains why', async () => {
  const loaded = Array.from({ length: 110 }, (_, i) => saved(`r${i + 1}`, i + 1, `S${String(i + 1).padStart(3, '0')}`));
  const f = await manualFixture({ loaded });
  await f.click(f.elements.manualSelectShown);
  assert.match(feedback(f), /^Selecting the 110 shown receipts that are not selected yet would pass the limit of 100 \(0 already selected, room for 100 more\)\. Nothing was selected; narrow the filters or deselect some receipts first\.$/);
  assert.equal(summary(f).count, '0 of 100');
  await setFilter(f, 'optimizationMaxAmount', '100'); await f.click(f.elements.manualSelectShown);
  assert.equal(summary(f).count, '100 of 100', 'with the filter narrowed it fits exactly');
});

test('B: Clear selection clears the manual selection only (no dialog for a small selection)', async () => {
  const f = await receiptFixture({ loaded: six() });
  await bestMatch(f, '600'); const bestLabel = f.elements.exportSelected.textContent;
  await toManual(f); await picks(f, 'Store A', 'Store B');
  assert.equal(f.elements.manualClearSelection.disabled, false);
  await f.click(f.elements.manualClearSelection);
  assert.equal(summary(f).count, '0 of 100'); assert.equal(feedback(f), 'Manual selection cleared.'); assert.equal(f.elements.manualClearSelection.disabled, true);
  assert.deepEqual([f.calls.update.length, f.calls.create.length], [0, 0]); assert.equal(f.rows().length, 6, 'the receipts themselves are untouched');
  await toBest(f); assert.equal(f.elements.exportSelected.textContent, bestLabel, 'the optimizer result is untouched');
});

test('B: clearing a large selection asks first, and keeping it changes nothing', async () => {
  const loaded = Array.from({ length: 30 }, (_, i) => saved(`r${i + 1}`, i + 1, `S${String(i + 1).padStart(2, '0')}`));
  const answers = [false, true]; const asked = [];
  const f = await manualFixture({ loaded, confirm: async options => { asked.push(options.title); return answers.shift(); } });
  await f.click(f.elements.manualSelectShown); assert.equal(summary(f).count, '30 of 100');
  await f.click(f.elements.manualClearSelection); assert.equal(summary(f).count, '30 of 100'); assert.deepEqual(asked, ['Clear the manual selection?']);
  await f.click(f.elements.manualClearSelection); assert.equal(summary(f).count, '0 of 100');
});

// ---- C. filtering and sorting -----------------------------------------------------------------------------------------------------------------
test('C: the selection survives search, store, date and sort changes, hidden selections are counted, and the summary covers all of it', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store A', 'Store B');
  await setFilter(f, 'optimizationStoreFilter', 'store c');
  assert.deepEqual(f.cards().map(item => item.part('.compact-store').textContent), ['Store C']);
  assert.equal(f.elements.optimizationHiddenSelected.textContent, '2 selected receipts are hidden by the current filters.');
  assert.deepEqual(summary(f), { count: '2 of 100', total: '₱300.00', noAmount: '', hidden: '2' }, 'the summary is for the complete selection');
  await picks(f, 'Store C');
  await setFilter(f, 'optimizationStoreFilter', '');
  await setFilter(f, 'optimizationSort', 'amount-desc'); await setFilter(f, 'optimizationSort', 'store-desc');
  assert.deepEqual(selectedStores(f).sort(), ['Store A', 'Store B', 'Store C']);
  await setFilter(f, 'optimizationStartDate', '2026-08-05');
  assert.equal(summary(f).hidden, '3'); assert.equal(summary(f).count, '3 of 100');
  await setFilter(f, 'optimizationStartDate', '');
  await review(f); assert.deepEqual(storesInReview(f), ['Store A', 'Store B', 'Store C'], 'A, B, then C: neither filters nor sorting reorder the export');
  assert.equal(new Set(order(f)).size, 3, 'no duplicate ids');
});

test('C: changing the sort never changes the manual export order', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store E', 'Store A', 'Store D');
  await setFilter(f, 'optimizationSort', 'amount-asc'); assert.deepEqual(f.cards().map(item => item.part('.compact-store').textContent).slice(0, 2), ['Store A', 'Store B']);
  await review(f); assert.deepEqual(storesInReview(f), ['Store E', 'Store A', 'Store D']);
});

test('C: selection is by saved id: it follows the receipt when the list order changes', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store B', 'Store D');
  f.list.children.splice(0, 1); await setFilter(f, 'optimizationSort', 'default'); // Receipt 1 leaves the list: every other row shifts by one
  assert.deepEqual(selectedStores(f).sort(), ['Store B', 'Store D'], 'the same receipts stay selected');
  await review(f); assert.deepEqual(f.calls.snapshot.at(-1), ['r2', 'r4']);
});

// ---- D. amounts -------------------------------------------------------------------------------------------------------------------------------
const mixed = () => [saved('a', 1000, 'Amount A'), saved('b', '', 'Blank B'), saved('c', 0, 'Zero C'), saved('d', 500, 'Amount D')];

test('D: blank is valid but not zero: the summary counts it separately, excludes it from the total, and keeps zero in the count', async () => {
  const f = await manualFixture({ loaded: mixed() });
  await picks(f, 'Amount A', 'Blank B', 'Zero C', 'Amount D');
  assert.deepEqual(summary(f), { count: '4 of 100', total: '₱1,500.00', noAmount: '1 (not counted in the total)', hidden: '' });
  assert.equal(card(f, 'Blank B').part('.compact-amount').textContent, 'No amount', 'a blank amount never looks like zero');
  assert.equal(card(f, 'Zero C').part('.compact-amount').textContent.replace(/\s/g, ''), '₱0.00');
});

test('D: the exact centavo sum has no floating-point drift', async () => {
  const f = await manualFixture({ loaded: [saved('a', 0.1, 'Tenth'), saved('b', 0.2, 'Fifth'), saved('c', 0.7, 'Seven')] });
  await f.click(f.elements.manualSelectShown);
  assert.equal(summary(f).total, '₱1.00');
});

test('D, F: blank, zero and positive amounts all export: blank is an EMPTY cell, zero is numeric 0, nothing becomes text', async () => {
  const f = await manualFixture({ loaded: mixed() });
  await picks(f, 'Amount D', 'Blank B', 'Zero C', 'Amount A');
  await review(f);
  assert.equal(dialogOpen(f), true); assert.deepEqual(storesInReview(f), ['Amount D', 'Blank B', 'Zero C', 'Amount A']);
  const amounts = items(f).map(item => item.reviewParts.amount.textContent.replace(/\s/g, ''));
  assert.deepEqual(amounts, ['₱500.00', 'Noamount', '₱0.00', '₱1,000.00'], 'the dialog says "No amount", never ₱0.00');
  assert.equal(f.elements.exportReviewTotal.textContent.replace(/\s/g, ''), '₱1,500.00'); assert.match(f.elements.exportReviewNoAmount.textContent, /^1 without an amount/);
  await confirm(f);
  const rows = buildExpenseDetailedReportRows(f.calls.download[0]).slice(2);
  assert.deepEqual(rows.map(row => [row[0], row[2], row[7], typeof row[7]]), [[1, 'Amount D', 500, 'number'], [2, 'Blank B', null, 'object'], [3, 'Zero C', 0, 'number'], [4, 'Amount A', 1000, 'number']]);
  assert.deepEqual(f.calls.consume, [['d', 'b', 'c', 'a']]);
});

test('D: an amount typed but not saved (valid or not) blocks the export with a manual-mode message, and the typed text is kept', async () => {
  const f = await manualFixture({ loaded: mixed() });
  await picks(f, 'Amount A', 'Amount D');
  await f.type(f.rows()[0], 'amount', '12,34.50');
  await review(f);
  assert.equal(dialogOpen(f), false); assert.equal(f.calls.snapshot.length, 0);
  assert.match(feedback(f), /Receipt 1 has unsaved changes\. Save them in Encoding, then choose Export Selected again\. Nothing was exported\./);
  assert.doesNotMatch(feedback(f), /Find Best Match/, 'a manual selection is never told to run the optimizer');
  assert.equal(f.field(f.rows()[0], 'amount').value, '12,34.50'); assert.equal(f.elements.manualGoToEncoding.hidden, false);
  assert.equal(f.elements.exportGoToEncoding.hidden, true, 'the Go to Encoding button of the active mode is the one shown');
});

// ---- E. Review & Arrange ------------------------------------------------------------------------------------------------------------------------
const layout = f => items(f).forEach(item => { item.getBoundingClientRect = () => { const k = items(f).indexOf(item); return { top: 100 + 60 * k, height: 56, bottom: 156 + 60 * k, left: 0, right: 600 }; }; });
const middle = k => 100 + 60 * k + 28;
const parts = (f, id) => items(f).find(item => item.dataset.receiptId === id).reviewParts;
const press = (f, id, key) => parts(f, id).row.emit('keydown', { key, target: parts(f, id).row });

test('E: the dialog opens in click order with the right count, total and details, and every reorder interaction works', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store D', 'Store B', 'Store A', 'Store C');
  await review(f); layout(f);
  assert.equal(dialogOpen(f), true); assert.equal(f.elements.exportReviewCount.textContent, '4');
  assert.equal(f.elements.exportReviewTotal.textContent.replace(/\s/g, ''), '₱1,000.00');
  assert.deepEqual(order(f), ['r4', 'r2', 'r1', 'r3'], 'D, B, A, C');
  const total = f.elements.exportReviewTotal.textContent;
  await parts(f, 'r3').up.emit('click'); assert.deepEqual(order(f), ['r4', 'r2', 'r3', 'r1']);
  await press(f, 'r4', 'End'); assert.deepEqual(order(f), ['r2', 'r3', 'r1', 'r4']);
  layout(f);
  parts(f, 'r1').row.emit('pointerdown', { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 5, clientY: middle(2) });
  parts(f, 'r1').row.emit('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 5, clientY: middle(2) - 30 });
  parts(f, 'r1').row.emit('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 5, clientY: 0 });
  parts(f, 'r1').row.emit('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 5, clientY: 0 });
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4'], 'a drag moved it to the top');
  assert.equal(f.elements.exportReviewTotal.textContent, total, 'the total never changes');
  assert.deepEqual([...order(f)].sort(), ['r1', 'r2', 'r3', 'r4'], 'membership is unchanged');
  await f.elements.exportReviewReset.emit('click'); assert.deepEqual(order(f), ['r4', 'r2', 'r1', 'r3'], 'Reset order returns to the click order');
});

test('E: Cancel and reopen keep the arrangement while the selection is unchanged; changing the selection discards it', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store A', 'Store B', 'Store C'); await review(f);
  await press(f, 'r3', 'Home'); const arranged = [...order(f)];
  await f.click(f.elements.cancelExport); assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  await review(f); assert.deepEqual(order(f), arranged);
  await f.click(f.elements.cancelExport);
  await pick(f, 'Store D'); await review(f);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4'], 'a different selection starts from its own click order');
});

test('E: the confirmed order is the workbook order; the totals match', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store C', 'Store A', 'Store E'); await review(f); await press(f, 'r5', 'Home');
  await confirm(f);
  assert.deepEqual(f.calls.download[0].map(item => item.dbId), ['r5', 'r3', 'r1']);
  assert.deepEqual(buildExpenseDetailedReportRows(f.calls.download[0]).slice(2).map(row => [row[0], row[2], row[7]]), [[1, 'Store E', 500], [2, 'Store C', 300], [3, 'Store A', 100]]);
});

// ---- F. export integrity ------------------------------------------------------------------------------------------------------------------------
test('F: a successful manual export consumes exactly the confirmed receipts and finishes the selection', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store B', 'Store D'); await review(f);
  assert.equal(f.calls.snapshot.length, 1, 'Snapshot A'); await confirm(f); assert.equal(f.calls.snapshot.length, 2, 'Snapshot B');
  assert.deepEqual(f.calls.consume, [['r2', 'r4']]);
  assert.deepEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(id => f.db.get(id).status), ['available', 'consumed', 'available', 'consumed', 'available', 'available'], 'nothing else is consumed');
  assert.equal(feedback(f), '2 receipts exported and marked as Consumed.'); assert.equal(dialogOpen(f), false);
  assert.equal(summary(f).count, '0 of 100'); assert.equal(f.elements.manualExportSelected.disabled, true);
  assert.deepEqual(f.cards().map(item => item.part('.compact-store').textContent), ['Store A', 'Store C', 'Store E', 'Store F'], 'Consumed receipts leave the Available view');
  assert.equal(f.rows().length, 6, 'no duplicate or missing receipt rows');
  await review(f); assert.equal(dialogOpen(f), false); assert.equal(f.calls.download.length, 1);
});

test('F: with nothing selected the export button is disabled and says so when forced', async () => {
  const f = await manualFixture({ loaded: six() });
  assert.equal(f.elements.manualExportSelected.disabled, true); assert.equal(f.elements.manualExportSelected.textContent, 'Export Selected (0)');
  await review(f); assert.equal(feedback(f), 'Select at least one receipt before exporting.'); assert.equal(f.calls.snapshot.length, 0);
});

test('F: unsaved local edits on a selected receipt block the export; nothing is saved, discarded or exported', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store A', 'Store B');
  f.field(f.rows()[1], 'store').value = 'Store B edited';
  await review(f);
  assert.equal(dialogOpen(f), false); assert.match(feedback(f), /Receipt 2 has unsaved changes/);
  assert.deepEqual([f.calls.snapshot.length, f.calls.update.length, f.calls.download.length], [0, 0, 0]);
  assert.equal(f.field(f.rows()[1], 'store').value, 'Store B edited'); assert.equal(summary(f).count, '2 of 100', 'the receipt stays selected');
});

test('F: a receipt Consumed in another session blocks the export, is named, and leaves the selection while the others stay', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store A', 'Store B', 'Store C');
  otherSession(f, 'r2', { status: 'consumed' });
  await review(f);
  assert.equal(dialogOpen(f), false); assert.match(feedback(f), /^Receipt 2 is no longer Available \(already Consumed in another session\) and was removed from your selection\. Nothing was exported\./);
  assert.doesNotMatch(feedback(f), /Find Best Match/);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.deepEqual(selectedStores(f), ['Store A', 'Store C'], 'unaffected receipts stay selected'); assert.equal(f.rows()[1].dataset.receiptStatus, 'consumed');
  await review(f); assert.equal(dialogOpen(f), true, 'the corrected selection can be exported'); assert.deepEqual(storesInReview(f), ['Store A', 'Store C']);
});

test('F: a receipt deleted in another session blocks the export and is removed from the selection', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store A', 'Store B'); f.db.delete('r1');
  await review(f);
  assert.match(feedback(f), /^Receipt 1 no longer exists in your saved receipts and was removed from your selection\. Nothing was exported\./);
  assert.equal(dialogOpen(f), false); assert.deepEqual(f.calls.download, []);
  assert.deepEqual(selectedStores(f), ['Store B']);
});

test('F: a saved amount changed in another session blocks this attempt, shows the new amount, and keeps the selection for a fresh review', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store A', 'Store B'); otherSession(f, 'r2', { amount: 250 });
  await review(f);
  assert.equal(dialogOpen(f), false); assert.deepEqual(f.calls.download, []);
  assert.match(feedback(f), /Receipt 2 was changed after it was selected \(Amount and Last updated\)\./);
  assert.match(feedback(f), /Review your selection and choose Export Selected again\.$/); assert.doesNotMatch(feedback(f), /Find Best Match/);
  assert.equal(summary(f).count, '2 of 100', 'the selection is kept'); assert.equal(summary(f).total, '₱350.00', 'and the summary uses the refreshed saved amount');
  await review(f); assert.equal(dialogOpen(f), true, 'reviewing again with the refreshed values works');
  assert.equal(items(f).find(item => item.dataset.receiptId === 'r2').reviewParts.amount.textContent.replace(/\s/g, ''), '₱250.00');
});

test('F: other field changes show the saved values, name the change and need an acknowledgement that a further change invalidates', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store A', 'Store B'); otherSession(f, 'r2', { store: 'Renamed B' });
  await review(f);
  assert.equal(dialogOpen(f), true); assert.equal(f.elements.exportReviewAck.hidden, false); assert.equal(f.elements.confirmExport.disabled, true);
  assert.match(items(f).find(item => item.dataset.receiptId === 'r2').children[1].children[2].textContent, /^Updated since selection — Store name: "Store B" to "Renamed B"\./);
  await ack(f); assert.equal(f.elements.confirmExport.disabled, false);
  otherSession(f, 'r2', { store: 'Renamed again' });
  await confirm(f);
  assert.equal(dialogOpen(f), true); assert.equal(f.elements.exportReviewAckInput.checked, false, 'the earlier acknowledgement does not carry over'); assert.equal(f.elements.confirmExport.disabled, true);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  await ack(f); await confirm(f);
  assert.equal(f.calls.download[0].find(item => item.dbId === 'r2').store, 'Renamed again');
});

test('F: a change that makes a receipt unavailable while the dialog is open blocks the final export with nothing generated', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store A', 'Store B'); await review(f);
  otherSession(f, 'r1', { status: 'consumed' });
  await confirm(f);
  assert.equal(dialogOpen(f), false); assert.match(feedback(f), /No workbook was prepared and nothing was marked Consumed\./);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]); assert.deepEqual(selectedStores(f), ['Store B']);
});

test('F: generation failure consumes nothing; an unconfirmed status update is reported as uncertain and a retry is verified first', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store A', 'Store B'); await review(f);
  f.fails.download = new Error('disk full'); await confirm(f);
  assert.match(feedback(f), /^Could not prepare the XLSX export: disk full\. No receipt was marked Consumed\.$/); assert.equal(f.calls.consume.length, 0); assert.equal(summary(f).count, '2 of 100');
  f.fails.download = null; await review(f); f.fails.consumeResponseLost = new Error('lost'); await confirm(f);
  assert.match(feedback(f), /may already be Consumed/); assert.doesNotMatch(feedback(f), /still Available/);
  assert.equal(summary(f).count, '2 of 100', 'the selection is kept for investigation');
  f.fails.consumeResponseLost = null; const reads = f.calls.snapshot.length; await review(f);
  assert.ok(f.calls.snapshot.length > reads, 'the retry reads the database first');
  assert.match(feedback(f), /Receipt 1 and Receipt 2 are no longer Available/); assert.equal(dialogOpen(f), false); assert.equal(f.calls.download.length, 1, 'no duplicate workbook');
});

test('F: a double click on confirm exports once', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store A', 'Store B'); await review(f);
  await Promise.all([f.elements.confirmExport.emit('click'), f.elements.confirmExport.emit('click')]); await settle();
  assert.equal(f.calls.download.length, 1); assert.equal(f.calls.consume.length, 1);
});

// ---- G. Best Match and manual mode together -----------------------------------------------------------------------------------------------------
test('G: Best Match still exports exactly as before and removes the exported receipts from a manual selection (with a message)', async () => {
  const f = await receiptFixture({ loaded: six() });
  await toManual(f); await picks(f, 'Store F', 'Store A');
  await toBest(f); await bestMatch(f, '600');
  await f.click(f.elements.exportSelected); await f.click(f.elements.confirmExport);
  assert.deepEqual(f.calls.consume, [['r6']]); assert.equal(f.elements.difference.textContent, '1 receipt exported and marked as Consumed.');
  await toManual(f);
  assert.equal(summary(f).count, '1 of 100', 'only the receipt that is still Available remains selected'); assert.match(feedback(f), /1 selected receipt is no longer in the list or Available and was removed from the selection\./);
  assert.deepEqual(selectedStores(f), ['Store A']);
});

test('G: a manual export that consumed receipts of the Best Match result makes that result stale; an unrelated result is kept', async () => {
  const f = await receiptFixture({ loaded: six() });
  await bestMatch(f, '600'); const label = f.elements.exportSelected.textContent; // Store F
  await toManual(f); await picks(f, 'Store A'); await review(f); await f.click(f.elements.confirmExport);
  await toBest(f); assert.equal(f.elements.exportSelected.textContent, label, 'unrelated: still there');
  await toManual(f); await picks(f, 'Store F'); await review(f); await f.click(f.elements.confirmExport);
  await toBest(f);
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (0)'); assert.equal(f.elements.resultTitle.textContent, 'Result out of date');
  assert.equal(f.elements.difference.textContent, 'Some receipts in this result were exported with Manual Selection. Run Find Best Match again.');
});

test('G: editing a receipt in the Edit dialog keeps a manual selection (only Best Match results go stale)', async () => {
  const f = await manualFixture({ loaded: six() });
  await picks(f, 'Store B');
  f.elements.editModal.dataset.receiptIndex = '1'; f.elements.editAmount.value = '210';
  for (const [key, value] of Object.entries({ editReceiptDate: '2026-08-02', editVat: '', editInvoice: '', editStore: 'Store B', editAddress: '', editTin: '' })) f.elements[key].value = value;
  await f.elements.editForm.emit('submit', { submitter: null }); await settle();
  assert.equal(summary(f).count, '1 of 100'); assert.equal(summary(f).total, '₱210.00', 'the summary follows the saved correction');
});

test('G: Quick Optimizer and Monthly Filing are not touched by the new mode', async () => {
  for (const file of ['../ui/quickOptimizerUi.js', '../ui/monthlyFilingUi.js', '../services/optimizationService.js', '../services/exportService.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /manualSelection|exportMode|manualIds/, `${file} does not know about manual selection`);
  }
});

// ---- markup and styles --------------------------------------------------------------------------------------------------------------------------
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = (await readFile(new URL('../styles.css', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const rule = selector => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';

test('markup: the mode switch is an accessible radio group inside the Optimization workspace, Best Match first and checked by default', () => {
  const workspace = html.slice(html.indexOf('id="optimizationWorkspace"'), html.indexOf('id="monthlyFilingWorkspace"'));
  assert.match(workspace, /<fieldset class="export-mode">\s*<legend class="visually-hidden">Receipt selection method<\/legend>/);
  assert.match(workspace, /<input type="radio" name="exportMode" id="exportModeBestMatch" value="best-match" checked \/><span>Best Match<\/span>/);
  assert.match(workspace, /<input type="radio" name="exportMode" id="exportModeManual" value="manual" \/><span>Manual Selection<\/span>/);
  assert.ok(workspace.indexOf('<h1>My Receipt Optimization</h1>') < workspace.indexOf('exportModeBestMatch'), 'no new top-level module or route');
  assert.equal((html.match(/id="optimizationTab"/g) ?? []).length, 1);
  assert.match(workspace, /<section class="panel manual-panel" id="manualPanel" aria-label="Manual selection" hidden>/);
  for (const id of ['manualSelectedCount', 'manualSelectedTotal', 'manualNoAmount', 'manualHidden', 'manualSelectShown', 'manualClearSelection', 'manualExportSelected', 'manualGoToEncoding', 'manualFeedback']) assert.equal((workspace.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1, `#${id} once`);
  assert.match(workspace, /id="manualFeedback" role="status" aria-live="polite"/);
  assert.match(html, /<input class="manual-select" type="checkbox" hidden \/>/);
  const all = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]); assert.deepEqual(all.filter((id, index) => all.indexOf(id) !== index), []);
});

test('layout: the manual summary wraps (flex), the panel is outside the recommendation grid, and the recommendation grid rules are intact', () => {
  assert.match(rule('.manual-summary'), /display: flex; flex-wrap: wrap/);
  assert.match(rule('.manual-summary dd'), /overflow-wrap: anywhere/); assert.match(rule('.manual-panel .workflow-feedback'), /overflow-wrap: anywhere/);
  assert.equal(rule('.result-panel').match(/grid-template-columns: ([^;]+);/)?.[1], 'minmax(220px, 300px) minmax(0, 1fr)', 'the C3E2-UI-02 fix is untouched');
  assert.doesNotMatch(css, /\.result-panel[^{]*manual|manual[^{]*\.result-panel/);
  const resultPanel = html.slice(html.indexOf('class="panel result-panel"'), html.indexOf('</aside>'));
  assert.equal(resultPanel.includes('manualPanel'), false, 'the manual panel is not a child of the recommendation panel');
  assert.match(rule('.optimization-receipt-card.has-manual-pick'), /grid-template-columns: 28px minmax\(0, 1fr\) 120px 120px 104px; grid-template-areas: "pick details amount badge action"/);
  assert.match(css, /\.optimization-receipt-card\.has-manual-pick \{ grid-template-columns: 28px minmax\(0, 1fr\) auto; grid-template-areas: "pick details amount" "\. badge action"; \}/, 'phones stack the badge and action under the details');
  assert.equal([...css.matchAll(/\.target-card \{[^}]*position: sticky[^}]*\}/g)].length, 1);
});

test('styles: the switch and the checkboxes use theme tokens only and have visible focus', () => {
  const block = css.slice(css.indexOf('/* Export mode switch and Manual Selection'), css.indexOf('.hidden-selected { grid-column'));
  assert.ok(block.length > 800); assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(/);
  assert.match(block, /label:has\(input:focus-visible\) \{ outline: 3px solid/); assert.match(block, /label:has\(input:checked\) \{ background: var\(--primary\); color: var\(--on-primary\)/);
  assert.match(rule('.manual-select'), /accent-color: var\(--primary\)/); assert.match(rule('.manual-select'), /width: 22px; height: 22px/);
});
