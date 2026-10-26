// C3E4-R01: Best Match and Manual Selection each own a temporary Review & Arrange order. Neither mode may replace, reset or reuse the other's.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildExpenseDetailedReportRows } from '../services/exportService.js';
import { receiptFixture } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, amount, store, extra = {}) => ({ dbId, amount, store, receiptDate: '2026-08-01', ...extra });
const six = () => [saved('r1', 100, 'Store A'), saved('r2', 200, 'Store B', { receiptDate: '2026-08-02' }), saved('r3', 300, 'Store C', { receiptDate: '2026-08-03' }), saved('r4', 400, 'Store D', { receiptDate: '2026-08-04' }), saved('r5', 500, 'Store E', { receiptDate: '2026-08-05' }), saved('r6', 600, 'Store F', { receiptDate: '2026-08-06' })];
const setMode = async (f, mode) => { f.elements.exportModeManual.checked = mode === 'manual'; f.elements.exportModeBestMatch.checked = mode !== 'manual'; await (mode === 'manual' ? f.elements.exportModeManual : f.elements.exportModeBestMatch).emit('change'); return f; };
const card = (f, store) => f.cards().find(item => item.part('.compact-store').textContent === store);
const pick = (f, store) => card(f, store).part('.manual-select').emit('change');
const picks = async (f, ...stores) => { for (const store of stores) await pick(f, store); };
const items = f => f.elements.exportReviewList.children;
const order = f => items(f).map(item => item.dataset.receiptId);
const parts = (f, id) => items(f).find(item => item.dataset.receiptId === id).reviewParts;
const press = (f, id, key) => parts(f, id).row.emit('keydown', { key, target: parts(f, id).row });
const reviewManual = f => f.click(f.elements.manualExportSelected);
const reviewBest = f => f.click(f.elements.exportSelected);
const cancel = f => f.click(f.elements.cancelExport);
const confirm = f => f.click(f.elements.confirmExport);
const bestMatch = async (f, target) => { f.elements.target.value = target; await f.click(f.elements.calculate); };

// Manual: A, B, C arranged as C, A, B and cancelled.
const arrangeManual = async f => { await setMode(f, 'manual'); await picks(f, 'Store A', 'Store B', 'Store C'); await reviewManual(f); await press(f, 'r3', 'Home'); assert.deepEqual(order(f), ['r3', 'r1', 'r2']); await cancel(f); };
// Best Match for 1000 (always more than one receipt): the last receipt is moved to the top and the review cancelled. Returns [initial order, arranged order].
const arrangeBest = async f => {
  await setMode(f, 'best-match'); await bestMatch(f, '1000'); await reviewBest(f);
  const initial = order(f); assert.ok(initial.length > 1); await press(f, initial.at(-1), 'Home');
  const arranged = order(f); assert.notDeepEqual(arranged, initial); await cancel(f);
  return [initial, arranged];
};

test('R01: the manual arrangement survives switching to Best Match, running Find Best Match, and opening and cancelling its review', async () => {
  const f = await receiptFixture({ loaded: six() });
  await arrangeManual(f);
  await arrangeBest(f);
  await setMode(f, 'manual'); await reviewManual(f);
  assert.deepEqual(order(f), ['r3', 'r1', 'r2'], 'C, A, B is still the manual order');
});

test('R01: the Best Match arrangement survives opening and cancelling the Manual review', async () => {
  const f = await receiptFixture({ loaded: six() });
  const [, arranged] = await arrangeBest(f);
  await arrangeManual(f);
  await setMode(f, 'manual'); await reviewManual(f); await cancel(f);
  await setMode(f, 'best-match'); await reviewBest(f);
  assert.deepEqual(order(f), arranged);
});

test('R01: changing the manual selection resets only the manual arrangement', async () => {
  const f = await receiptFixture({ loaded: six() });
  await arrangeManual(f); const [, arranged] = await arrangeBest(f);
  await setMode(f, 'manual'); await pick(f, 'Store D'); await reviewManual(f);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3', 'r4'], 'a different selection starts from its click order'); await cancel(f);
  await setMode(f, 'best-match'); await reviewBest(f);
  assert.deepEqual(order(f), arranged, 'the Best Match arrangement is untouched');
});

test('R01: recalculating Best Match resets only the Best Match arrangement', async () => {
  const f = await receiptFixture({ loaded: six() });
  await arrangeManual(f); const [initial] = await arrangeBest(f);
  await bestMatch(f, '1000'); await reviewBest(f);
  assert.deepEqual(order(f), initial, 'a fresh result starts from the optimizer order'); await cancel(f);
  await setMode(f, 'manual'); await reviewManual(f);
  assert.deepEqual(order(f), ['r3', 'r1', 'r2'], 'the manual arrangement is untouched');
});

test('R01: Reset order affects only the arrangement being reviewed', async () => {
  const f = await receiptFixture({ loaded: six() });
  await arrangeManual(f); const [initial] = await arrangeBest(f);
  await setMode(f, 'best-match'); await reviewBest(f); await f.elements.exportReviewReset.emit('click');
  assert.deepEqual(order(f), initial); await cancel(f);
  await setMode(f, 'manual'); await reviewManual(f);
  assert.deepEqual(order(f), ['r3', 'r1', 'r2'], 'resetting Best Match left the manual order alone');
  await f.elements.exportReviewReset.emit('click'); assert.deepEqual(order(f), ['r1', 'r2', 'r3']); await cancel(f);
  await setMode(f, 'best-match'); await reviewBest(f);
  assert.deepEqual(order(f), initial);
});

test('R01: each mode exports its own confirmed order, even after the other mode was arranged', async () => {
  const f = await receiptFixture({ loaded: six() });
  await arrangeManual(f); const [, arranged] = await arrangeBest(f);
  await setMode(f, 'best-match'); await reviewBest(f); await confirm(f);
  assert.deepEqual(f.calls.download[0].map(item => item.dbId), arranged);
  assert.deepEqual(buildExpenseDetailedReportRows(f.calls.download[0]).slice(2).map(row => row[0]), arranged.map((_, index) => index + 1));
  await setMode(f, 'manual'); await reviewManual(f);
  assert.deepEqual(order(f), ['r3', 'r1', 'r2'], 'a Best Match export does not touch the unrelated manual selection or arrangement');
  await confirm(f);
  assert.deepEqual(f.calls.download[1].map(item => item.dbId), ['r3', 'r1', 'r2']);
});

test('R01: a successful manual export finishes the manual arrangement but keeps the Best Match one', async () => {
  const f = await receiptFixture({ loaded: six() });
  const [, arranged] = await arrangeBest(f);
  await arrangeManual(f);
  await setMode(f, 'manual'); await reviewManual(f); await confirm(f);
  assert.equal(f.elements.manualSelectedCount.textContent, '0 of 100');
  await picks(f, 'Store D'); await reviewManual(f);
  assert.deepEqual(order(f), ['r4']); await cancel(f);
  // The Best Match result is unrelated to A, B, C only when it does not use them: it is stale otherwise, and a new one starts from its own order.
  await setMode(f, 'best-match');
  if (f.elements.exportSelected.disabled) { await bestMatch(f, '1000'); await reviewBest(f); assert.ok(order(f).length > 1); }
  else { await reviewBest(f); assert.deepEqual(order(f), arranged); }
});

test('R01: logout and a user change clear both arrangements', async () => {
  const f = await receiptFixture({ loaded: six() });
  await arrangeManual(f); const [initial] = await arrangeBest(f);
  f.ui.clearForLogout(); await f.ui.loadForUser({ id: 'user-1' });
  await setMode(f, 'manual'); await picks(f, 'Store A', 'Store B', 'Store C'); await reviewManual(f);
  assert.deepEqual(order(f), ['r1', 'r2', 'r3']); await cancel(f);
  await setMode(f, 'best-match'); await bestMatch(f, '1000'); await reviewBest(f);
  assert.deepEqual(order(f), initial);
});

test('R01: arrangements are separate in-memory slots per mode and are never stored', async () => {
  const source = (await readFile(new URL('../ui/receiptUi.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.match(source, /const arrangements = \{ 'best-match': null, manual: null \};/);
  assert.doesNotMatch(source, /let arrangement\b/, 'no single shared arrangement variable remains');
  assert.match(source, /const setManualIds = ids => \{[^}]*arrangements\.manual = null;/);
  assert.match(source, /arrangements\['best-match'\] = null; selection = null;/);
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)[^\n]*arrangements/);
});

// ---- C3E4-R02: a receipt a snapshot proved missing cannot be picked again ----------------------------------------------------------------------
const feedbackText = f => f.elements.manualFeedback.textContent;
const selected = f => f.cards().filter(item => item.classList.contains('is-selected')).map(item => item.part('.compact-store').textContent);
const deletedScenario = async () => {
  const f = await receiptFixture({ loaded: six() });
  await setMode(f, 'manual'); await picks(f, 'Store A', 'Store B', 'Store C');
  f.db.delete('r2');
  await reviewManual(f);
  return f;
};

test('R02: a receipt deleted elsewhere blocks the export, leaves the selection, and nothing is exported or Consumed', async () => {
  const f = await deletedScenario();
  assert.equal(f.elements.exportConfirmModal.hidden, true);
  assert.match(feedbackText(f), /^Receipt 2 no longer exists in your saved receipts and was removed from your selection\. Nothing was exported\./);
  assert.doesNotMatch(feedbackText(f), /current saved values/, 'a deleted receipt has no saved values to show');
  assert.match(feedbackText(f), /Review your selection and choose Export Selected again\.$/);
  assert.deepEqual(selected(f), ['Store A', 'Store C'], 'unrelated selections remain');
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.deepEqual(['r1', 'r3'].map(id => f.db.get(id).status), ['available', 'available']);
});

test('R02: the missing receipt\'s checkbox is disabled, labelled, and Select shown skips it', async () => {
  const f = await deletedScenario();
  const gone = card(f, 'Store B').part('.manual-select');
  assert.equal(gone.disabled, true); assert.match(gone.getAttribute('aria-label'), /Receipt 2 no longer exists in your saved receipts and cannot be selected/);
  await gone.emit('change'); assert.deepEqual(selected(f), ['Store A', 'Store C'], 'a forced change event cannot reselect it');
  assert.match(f.elements.manualSelectShown.textContent, /Select shown \(3\)/, 'D, E and F are still to add (A and C are selected); the missing Store B is never counted');
  await f.click(f.elements.manualSelectShown);
  assert.deepEqual(selected(f), ['Store A', 'Store C', 'Store D', 'Store E', 'Store F']);
  assert.equal(f.elements.manualSelectedCount.textContent, '5 of 100');
});

test('R02: the local row keeps its unsaved fields and is not marked Consumed', async () => {
  const f = await receiptFixture({ loaded: six() });
  await setMode(f, 'manual'); await picks(f, 'Store A', 'Store B');
  f.db.delete('r2');
  await reviewManual(f);
  const row = f.rows().find(item => item.dataset.receiptDbId === 'r2');
  assert.ok(row, 'the row is not deleted automatically');
  assert.equal(row.dataset.receiptStatus, 'available');
});

test('R02: logout and a user change reset the known-missing state; nothing is stored', async () => {
  const f = await deletedScenario();
  f.ui.clearForLogout();
  f.db.set('r2', { ...saved('r2', 200, 'Store B', { receiptDate: '2026-08-02' }), status: 'available', updatedAt: f.stamp() });
  await f.ui.loadForUser({ id: 'user-2' }); await setMode(f, 'manual');
  assert.equal(card(f, 'Store B').part('.manual-select').disabled, false, 'selectable again for a new session');
  await pick(f, 'Store B'); assert.deepEqual(selected(f), ['Store B']);
  const source = (await readFile(new URL('../ui/receiptUi.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.doesNotMatch(source, /(?:localStorage|sessionStorage)[^\n]*knownMissing/);
  assert.equal(source.split('knownMissingIds.clear()').length - 1, 2, 'cleared on user load and on logout');
});
