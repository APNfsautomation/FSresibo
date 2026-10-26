// C3E4-R03: strict manual eligibility (judged on the SAVED status) and asynchronous export isolation (a pending snapshot belongs to the mode that started it).
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExpenseDetailedReportRows } from '../services/exportService.js';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, amount, store, extra = {}) => ({ dbId, amount, store, receiptDate: '2026-08-01', ...extra });
const six = () => [saved('r1', 100, 'Store A'), saved('r2', 200, 'Store B', { receiptDate: '2026-08-02' }), saved('r3', 300, 'Store C', { receiptDate: '2026-08-03' }), saved('r4', 400, 'Store D', { receiptDate: '2026-08-04' }), saved('r5', 500, 'Store E', { receiptDate: '2026-08-05' }), saved('r6', 600, 'Store F', { receiptDate: '2026-08-06' })];
const storeOf = { r1: 'Store A', r2: 'Store B', r3: 'Store C', r4: 'Store D', r5: 'Store E', r6: 'Store F' };
const setMode = async (f, mode) => { f.elements.exportModeManual.checked = mode === 'manual'; f.elements.exportModeBestMatch.checked = mode !== 'manual'; await (mode === 'manual' ? f.elements.exportModeManual : f.elements.exportModeBestMatch).emit('change'); return f; };
const card = (f, store) => f.cards().find(item => item.part('.compact-store').textContent === store);
const box = (f, store) => card(f, store).part('.manual-select');
const pick = (f, store) => box(f, store).emit('change');
const picks = async (f, ...stores) => { for (const store of stores) await pick(f, store); };
const selected = f => f.cards().filter(item => item.classList.contains('is-selected')).map(item => item.part('.compact-store').textContent);
const items = f => f.elements.exportReviewList.children;
const order = f => items(f).map(item => item.dataset.receiptId);
const parts = (f, id) => items(f).find(item => item.dataset.receiptId === id).reviewParts;
const press = (f, id, key) => parts(f, id).row.emit('keydown', { key, target: parts(f, id).row });
const reviewManual = f => f.click(f.elements.manualExportSelected);
const reviewBest = f => f.click(f.elements.exportSelected);
const cancel = f => f.click(f.elements.cancelExport);
const bestMatch = async (f, target) => { f.elements.target.value = target; await f.click(f.elements.calculate); };
const manualFeedback = f => f.elements.manualFeedback.textContent;
// Holds the next database snapshot until released, so a test can act while an export is mid-flight.
const gate = f => { let release; f.fails.snapshotGate = new Promise(resolve => { release = resolve; }); return () => { f.fails.snapshotGate = null; release(); }; };

// ---- A. strict manual eligibility ----------------------------------------------------------------------------------------------------------
const statusFixture = async () => {
  const f = await receiptFixture({ loaded: [saved('ok', 100, 'Ok Store'), saved('used', 110, 'Used Store', { status: 'consumed' }), saved('odd', 120, 'Odd Store', { status: 'archived' }), saved('pend', 130, 'Pending Store', { status: 'pending' }), saved('empty', 140, 'Empty Store', { status: '' }), saved('nul', 150, 'Null Store', { status: null }), saved('undef', 160, 'Undefined Store', { status: undefined })] });
  f.elements.receiptStatusFilter.value = 'all'; await f.elements.receiptStatusFilter.emit('change'); await settle();
  return setMode(f, 'manual');
};

test('R03-A: only a saved receipt whose saved status is exactly "available" can be selected; every other status is refused', async () => {
  const f = await statusFixture();
  assert.equal(box(f, 'Ok Store').disabled, false);
  for (const store of ['Used Store', 'Odd Store', 'Pending Store', 'Empty Store', 'Null Store', 'Undefined Store']) assert.equal(box(f, store).disabled, true, store);
  assert.match(box(f, 'Used Store').getAttribute('aria-label'), /is Consumed and cannot be selected/);
  assert.match(box(f, 'Odd Store').getAttribute('aria-label'), /is not Available and cannot be selected/);
});

test('R03-A: Select shown skips every ineligible receipt, and a forged checkbox change event cannot add one', async () => {
  const f = await statusFixture();
  assert.equal(f.elements.manualSelectShown.textContent, 'Select shown (1)');
  await f.click(f.elements.manualSelectShown); assert.deepEqual(selected(f), ['Ok Store']);
  await pick(f, 'Ok Store'); assert.deepEqual(selected(f), [], 'deselecting still works');
  for (const store of ['Odd Store', 'Pending Store', 'Empty Store', 'Null Store', 'Undefined Store', 'Used Store']) { await pick(f, store); assert.deepEqual(selected(f), [], `${store} was not added by a forged change event`); }
  assert.equal(f.elements.manualSelectedCount.textContent, '0 of 100');
});

test('R03-A: an old checkbox cannot add a receipt that became Consumed after the card was drawn', async () => {
  const f = await receiptFixture({ loaded: six() });
  await setMode(f, 'manual');
  const stale = box(f, 'Store B'); // drawn while Available
  await pick(f, 'Store B'); await f.click(f.elements.manualExportSelected); await f.click(f.elements.confirmExport);
  assert.equal(f.db.get('r2').status, 'consumed');
  await stale.emit('change');
  assert.equal(f.elements.manualSelectedCount.textContent, '0 of 100', 'the old checkbox could not add it');
});

test('R03-A: an unrelated selection survives stale-id pruning, and a deleted receipt stays excluded afterwards', async () => {
  const f = await receiptFixture({ loaded: six() });
  await setMode(f, 'manual'); await picks(f, 'Store A', 'Store B', 'Store C');
  f.db.delete('r2'); await reviewManual(f);
  assert.deepEqual(selected(f), ['Store A', 'Store C']);
  assert.equal(box(f, 'Store B').disabled, true);
  await f.click(f.elements.manualSelectShown); assert.ok(!selected(f).includes('Store B'));
});

test('R03-A: a saved Available receipt with unsaved local edits stays selected but cannot be exported until saved', async () => {
  const f = await receiptFixture({ loaded: six() });
  await setMode(f, 'manual'); await picks(f, 'Store A', 'Store B');
  await f.type(f.rows()[0], 'amount', '150');
  assert.deepEqual(selected(f), ['Store A', 'Store B'], 'selection is not about unsaved edits');
  assert.equal(box(f, 'Store A').disabled, false);
  await reviewManual(f);
  assert.equal(f.elements.exportConfirmModal.hidden, true); assert.match(manualFeedback(f), /Receipt 1 has unsaved changes/);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
});

// ---- B. asynchronous export isolation ---------------------------------------------------------------------------------------------------------
// Manual and Best Match both hold a selection and a different arrangement; the originating mode's export is mid-flight when the user switches modes.
const bothArranged = async () => {
  const f = await receiptFixture({ loaded: six() });
  await bestMatch(f, '1000'); await reviewBest(f);
  const bestInitial = order(f); await press(f, bestInitial.at(-1), 'Home'); const bestArranged = order(f); await cancel(f);
  await setMode(f, 'manual'); await picks(f, 'Store A', 'Store B', 'Store C');
  await reviewManual(f); await press(f, 'r3', 'Home'); assert.deepEqual(order(f), ['r3', 'r1', 'r2']); await cancel(f);
  return { f, bestInitial, bestArranged };
};

test('R03-B: a manual export whose Snapshot B finds a deleted receipt, after the user switched to Best Match, is handled as a MANUAL export', async () => {
  const { f, bestArranged } = await bothArranged();
  const bestButton = f.elements.exportSelected.textContent;
  await reviewManual(f);
  const release = gate(f);
  const pending = f.elements.confirmExport.emit('click'); await settle();
  await setMode(f, 'best-match'); // the active mode changes while Snapshot B is pending
  f.db.delete('r2'); release(); await pending; await settle();
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0], 'no workbook, nothing Consumed');
  assert.equal(f.elements.exportConfirmModal.hidden, true);
  assert.equal(f.elements.exportSelected.textContent, bestButton, 'the Best Match result was not cleared');
  await reviewBest(f); assert.deepEqual(order(f), bestArranged, 'the Best Match arrangement is intact'); await cancel(f);
  await setMode(f, 'manual');
  assert.deepEqual(selected(f), ['Store A', 'Store C'], 'only the deleted receipt left the manual selection');
  assert.match(manualFeedback(f), /Receipt 2 no longer exists in your saved receipts and was removed from your selection\./);
  assert.equal(box(f, 'Store B').disabled, true);
});

test('R03-B: a Best Match export whose Snapshot B finds a Consumed receipt, after the user switched to Manual, is handled as a BEST MATCH export', async () => {
  const { f } = await bothArranged();
  await setMode(f, 'best-match'); await reviewBest(f);
  const ids = order(f); const consumedElsewhere = ids[0];
  const release = gate(f);
  const pending = f.elements.confirmExport.emit('click'); await settle();
  await setMode(f, 'manual');
  f.db.set(consumedElsewhere, { ...f.db.get(consumedElsewhere), status: 'consumed', updatedAt: f.stamp() }); release(); await pending; await settle();
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.equal(f.elements.exportConfirmModal.hidden, true);
  await setMode(f, 'best-match');
  assert.equal(f.elements.resultTitle.textContent, 'Result out of date', 'the Best Match result is the one that went stale');
  assert.match(f.elements.difference.textContent, /Run Find Best Match again\./);
  await setMode(f, 'manual');
  const expected = ['r1', 'r2', 'r3'].filter(id => id !== consumedElsewhere).map(id => storeOf[id]);
  assert.deepEqual(selected(f), expected, 'the manual selection only loses a receipt that really is Consumed now');
});

test('R03-B: cancelling a review never discards the other mode\'s arrangement', async () => {
  const { f, bestArranged } = await bothArranged();
  await reviewManual(f); await cancel(f);
  await setMode(f, 'best-match'); await reviewBest(f);
  assert.deepEqual(order(f), bestArranged); await cancel(f);
  await setMode(f, 'manual'); await reviewManual(f);
  assert.deepEqual(order(f), ['r3', 'r1', 'r2']);
});

test('R03-B: a successful manual export clears only the manual selection; a Best Match export removes only its own receipts from the other mode', async () => {
  const f = await receiptFixture({ loaded: six() });
  await setMode(f, 'manual'); await picks(f, 'Store A', 'Store F', 'Store C');
  await reviewManual(f); await f.click(f.elements.confirmExport);
  assert.deepEqual(f.calls.consume, [['r1', 'r6', 'r3']]); assert.equal(f.elements.manualSelectedCount.textContent, '0 of 100');
  await picks(f, 'Store D', 'Store E');
  await setMode(f, 'best-match'); await bestMatch(f, '500'); // Store E alone
  await reviewBest(f); await f.click(f.elements.confirmExport);
  assert.deepEqual(f.calls.consume.at(-1), ['r5'], 'exactly the Best Match receipts');
  await setMode(f, 'manual');
  assert.deepEqual(selected(f), ['Store D'], 'the manual selection kept the receipt that is still Available');
  assert.deepEqual(['r2', 'r4'].map(id => f.db.get(id).status), ['available', 'available']);
});

test('R03: blocked exports download nothing and consume nothing; blank stays an empty amount and zero stays 0 in a successful export', async () => {
  const f = await receiptFixture({ loaded: [saved('b', '', 'Blank'), saved('z', 0, 'Zero'), saved('p', 250, 'Plain')] });
  await setMode(f, 'manual'); await picks(f, 'Blank', 'Zero', 'Plain');
  f.db.delete('p'); await reviewManual(f);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  await reviewManual(f); await f.click(f.elements.confirmExport);
  assert.deepEqual(f.calls.consume, [['b', 'z']]);
  assert.deepEqual(f.calls.download[0].map(item => [item.dbId, item.amount]), [['b', ''], ['z', '0.00']]);
  const rows = buildExpenseDetailedReportRows(f.calls.download[0]).slice(2).map(row => row[7]);
  assert.deepEqual([rows[0], rows[1]], [null, 0], 'blank is an empty cell, zero is numeric 0');
});

test('R03: logout and a user change reset the manual selection, arrangements, known-missing ids and the mode', async () => {
  const { f } = await bothArranged();
  f.db.delete('r2'); await reviewManual(f);
  f.ui.clearForLogout(); f.db.set('r2', { ...saved('r2', 200, 'Store B', { receiptDate: '2026-08-02' }), status: 'available', updatedAt: f.stamp() });
  await f.ui.loadForUser({ id: 'user-2' });
  assert.equal(f.elements.manualPanel.hidden, true);
  await setMode(f, 'manual'); assert.equal(f.elements.manualSelectedCount.textContent, '0 of 100'); assert.equal(box(f, 'Store B').disabled, false);
  await picks(f, 'Store A', 'Store B', 'Store C'); await reviewManual(f);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3'], 'no arrangement survived');
});
