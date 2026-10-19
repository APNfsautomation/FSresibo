// C3E4-R04: the persisted receipt status must survive the service mapping boundary, so an unexpected database status is never mistaken for Available.
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyExportSnapshot } from '../domain/exportArrangement.js';
import { fromDatabaseReceipt } from '../services/receiptService.js';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, amount, store, extra = {}) => ({ dbId, amount, store, receiptDate: '2026-08-01', ...extra });
const six = () => [saved('r1', 100, 'Store A'), saved('r2', 200, 'Store B', { receiptDate: '2026-08-02' }), saved('r3', 300, 'Store C', { receiptDate: '2026-08-03' }), saved('r4', 400, 'Store D', { receiptDate: '2026-08-04' }), saved('r5', 500, 'Store E', { receiptDate: '2026-08-05' }), saved('r6', 600, 'Store F', { receiptDate: '2026-08-06' })];
const viaService = options => receiptFixture({ viaServiceMapping: true, ...options });
const setMode = async (f, mode) => { f.elements.exportModeManual.checked = mode === 'manual'; f.elements.exportModeBestMatch.checked = mode !== 'manual'; await (mode === 'manual' ? f.elements.exportModeManual : f.elements.exportModeBestMatch).emit('change'); return f; };
const card = (f, store) => f.cards().find(item => item.part('.compact-store').textContent === store);
const box = (f, store) => card(f, store).part('.manual-select');
const picks = async (f, ...stores) => { for (const store of stores) await box(f, store).emit('change'); };
const selected = f => f.cards().filter(item => item.classList.contains('is-selected')).map(item => item.part('.compact-store').textContent);
const reviewManual = f => f.click(f.elements.manualExportSelected);
const feedback = f => f.elements.manualFeedback.textContent;
// The optimization card list is only drawn with checkboxes in Manual Selection; read it there and come back.
const shownStores = async f => { await setMode(f, 'manual'); const names = f.cards().map(item => item.part('.compact-store').textContent); await setMode(f, 'best-match'); return names; };
const row = (status, extra = {}) => ({ id: 'x', amount: 10, receipt_date: '2026-08-01', store_name: 'S', ...(status === undefined ? {} : { status }), ...extra });

// ---- the mapping boundary itself ------------------------------------------------------------------------------------------------------------
test('R04: the service mapper keeps the exact persisted status; a missing or null status is "" and never Available', () => {
  for (const status of ['available', 'consumed', 'pending', 'archived', '']) assert.equal(fromDatabaseReceipt(row(status)).status, status);
  assert.equal(fromDatabaseReceipt(row(null)).status, '');
  assert.equal(fromDatabaseReceipt(row(undefined)).status, '');
  assert.equal(fromDatabaseReceipt(row('available')).amount, 10, 'the rest of the mapping is unchanged');
});

test('R04: the shared snapshot validator rejects a mapped receipt whose persisted status is not Available', () => {
  const entries = [{ dbId: 'x', label: 'Receipt 1' }];
  const verdict = status => classifyExportSnapshot({ entries, snapshotRows: [fromDatabaseReceipt(row(status))] });
  assert.equal(verdict('available').ok, true);
  for (const status of ['consumed', 'pending', 'archived', '', null, undefined]) assert.deepEqual(verdict(status).problems.map(problem => problem.type), ['unavailable'], String(status));
});

// ---- A and B: Manual Selection through the real mapper ------------------------------------------------------------------------------------------
test('R04-A: a saved Available receipt that went through the service mapper is selectable and exports normally', async () => {
  const f = await viaService({ loaded: six() });
  await setMode(f, 'manual'); await picks(f, 'Store B', 'Store A');
  await reviewManual(f); await f.click(f.elements.confirmExport);
  assert.deepEqual(f.calls.consume, [['r2', 'r1']]);
  assert.deepEqual(f.calls.download[0].map(item => item.dbId), ['r2', 'r1']);
  assert.equal(feedback(f), '2 receipts exported and marked as Consumed.');
});

test('R04-B: consumed, pending, archived, empty, null and undefined database statuses can never enter Manual Selection', async () => {
  const odd = [['Used', 'consumed'], ['Pending', 'pending'], ['Archived', 'archived'], ['Empty', ''], ['Null', null], ['Undefined', undefined]];
  const f = await viaService({ loaded: [saved('ok', 100, 'Ok'), ...odd.map(([store, status], index) => saved(`o${index}`, 110 + index, store, { status }))] });
  f.elements.receiptStatusFilter.value = 'all'; await f.elements.receiptStatusFilter.emit('change'); await settle();
  await setMode(f, 'manual');
  assert.equal(box(f, 'Ok').disabled, false);
  for (const [store] of odd) { assert.equal(box(f, store).disabled, true, store); await box(f, store).emit('change'); }
  assert.deepEqual(selected(f), [], 'forged change events changed nothing');
  assert.equal(f.elements.manualSelectShown.textContent, 'Select shown (1)');
  await f.click(f.elements.manualSelectShown); assert.deepEqual(selected(f), ['Ok']);
});

// ---- C and D: the database changes under a selection ------------------------------------------------------------------------------------------
for (const status of ['pending', 'archived', '', null]) {
  test(`R04-C: a selected receipt whose database status becomes ${JSON.stringify(status)} is blocked at Snapshot A: no workbook, nothing Consumed`, async () => {
    const f = await viaService({ loaded: six() });
    await setMode(f, 'manual'); await picks(f, 'Store A', 'Store B', 'Store C');
    f.db.set('r2', { ...f.db.get('r2'), status });
    await reviewManual(f);
    assert.equal(f.elements.exportConfirmModal.hidden, true);
    assert.match(feedback(f), /Receipt 2 is no longer Available/);
    assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
    assert.deepEqual(selected(f), ['Store A', 'Store C'], 'the ineligible receipt left the selection; the others stay');
    assert.equal(box(f, 'Store B').disabled, true, 'and it cannot be picked again');
  });
}

test('R04-C: a status that turns unexpected while the review is open is blocked at Snapshot B before any workbook is made', async () => {
  const f = await viaService({ loaded: six() });
  await setMode(f, 'manual'); await picks(f, 'Store A', 'Store B');
  await reviewManual(f); assert.equal(f.elements.exportConfirmModal.hidden, false);
  f.db.set('r1', { ...f.db.get('r1'), status: 'pending' });
  await f.click(f.elements.confirmExport);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.equal(f.elements.exportConfirmModal.hidden, true);
  assert.match(feedback(f), /Receipt 1 is no longer Available/);
  assert.deepEqual(['r1', 'r2'].map(id => f.db.get(id).status), ['pending', 'available'], 'nothing was written');
});

// ---- E: ordinary lifecycle and Best Match are unchanged -----------------------------------------------------------------------------------------
test('R04-E: Available and Consumed look and behave as before, and a Best Match export through the real mapper still works', async () => {
  const f = await viaService({ loaded: [...six(), saved('r7', 70, 'Used Store', { status: 'consumed' })] });
  assert.deepEqual(await shownStores(f), ['Store A', 'Store B', 'Store C', 'Store D', 'Store E', 'Store F'], 'Consumed stays out of the Available view');
  f.elements.target.value = '600'; await f.click(f.elements.calculate);
  await f.click(f.elements.exportSelected); await f.click(f.elements.confirmExport);
  assert.deepEqual(f.calls.consume.at(-1).length > 0, true);
  assert.equal(f.elements.resultTitle.textContent, 'Export complete');
  const consumed = f.calls.consume.at(-1); assert.ok(consumed.every(id => f.db.get(id).status === 'consumed'));
  assert.equal(f.db.get('r7').status, 'consumed');
  f.elements.receiptStatusFilter.value = 'consumed'; await f.elements.receiptStatusFilter.emit('change'); await settle();
  assert.equal((await shownStores(f)).length, 2, 'Consumed receipts are listed under the Consumed filter');
});

test('R04-E: an unexpected status row is still shown as an ordinary Available receipt (display is unchanged) but cannot be exported', async () => {
  const f = await viaService({ loaded: [saved('a', 100, 'Plain'), saved('w', 100, 'Weird', { status: 'pending' })] });
  assert.deepEqual(await shownStores(f), ['Plain', 'Weird'], 'presentation is normalized exactly as before');
  f.elements.target.value = '200'; await f.click(f.elements.calculate);
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (2)', 'Best Match still offers both, as before');
  await f.click(f.elements.exportSelected);
  assert.equal(f.elements.exportConfirmModal.hidden, true, 'the shared Snapshot A refuses it: the review never opens');
  assert.match(f.elements.difference.textContent, /no longer Available/);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0], 'no workbook, nothing Consumed');
  assert.equal(f.db.get('w').status, 'pending');
});
