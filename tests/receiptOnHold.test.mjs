// FSResibo v3.8.1 / Issue #64: On Hold receipts stay Available, but cannot
// be optimized, manually selected or consumed. Hosted SQL security is checked
// separately; these tests exercise the actual UI with a simulated database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { availableOptimizerReceipts } from '../ui/receiptUi.js';
import { manualEligibility } from '../domain/manualSelection.js';
import { classifyExportSnapshot } from '../domain/exportArrangement.js';
import { preflightExport, preflightMessage, snapshotProblemMessage } from '../ui/receiptExport.js';
import { fromDatabaseReceipt } from '../services/receiptService.js';
import { receiptFixture } from './helpers/receiptUiFixture.mjs';

const saved = (dbId, amount, store, extra = {}) => ({
  dbId, amount, store, receiptDate: '2026-11-10',
  expenseAccount: 'Day to day', classification: 'Meals', ...extra
});
const holdButton = row => row.part('.toggle-receipt-hold');
const idsShown = fixture => fixture.rows().filter(r => !r.hidden).map(r => r.dataset.receiptDbId);
const manual = async f => {
  f.elements.exportModeManual.checked = true;
  await f.elements.exportModeManual.emit('change');
};
const card = (f, store) => f.cards().find(c => c.part('.compact-store').textContent === store);

test('legacy receipt mapping defaults to not held; explicit database boolean is retained', () => {
  const raw = { id: 'x', status: 'available', amount: 25, store_name: 'Alpha', updated_at: 't1' };
  assert.equal(fromDatabaseReceipt(raw).isOnHold, false);
  assert.equal(fromDatabaseReceipt({ ...raw, is_on_hold: true }).isOnHold, true);
  assert.equal(fromDatabaseReceipt({ ...raw, is_on_hold: false }).isOnHold, false);
});

test('On Hold stays Available but is excluded from optimizer input, even at an exact target', () => {
  const rows = [
    { dbId: 'ready', status: 'available', cents: 15000, isOnHold: false },
    { dbId: 'pending', status: 'available', cents: 50000, isOnHold: true },
    { dbId: 'used', status: 'consumed', cents: 2000, isOnHold: false }
  ];
  assert.deepEqual(availableOptimizerReceipts(rows).map(r => r.dbId), ['ready']);
  assert.equal(manualEligibility({ dbId: 'pending', status: 'available', isOnHold: true }), 'on-hold');
  assert.equal(manualEligibility({ dbId: 'ready', status: 'available', isOnHold: false }), 'ok');
});

test('preflight and authoritative export snapshot independently reject On Hold', () => {
  const items = [{ label: 'Receipt 1', present: true, dbId: 'a', status: 'available', isOnHold: true, unsaved: false, amountProblem: '' }];
  const local = preflightExport(items);
  assert.deepEqual(local.problems.map(p => p.type), ['onHold']);
  assert.match(preflightMessage(local.problems), /Release Hold in Encoding/);
  const entries = [{ dbId: 'a', label: 'Receipt 1' }];
  const snapshotRows = [saved('a', 100, 'Test', { status: 'available', isOnHold: true })];
  const remote = classifyExportSnapshot({ entries, snapshotRows });
  assert.deepEqual(remote.problems.map(p => p.type), ['onHold']);
  assert.match(snapshotProblemMessage(remote.problems), /now On Hold/);
});

test('saved receipts have a Hold action, unsaved drafts cannot be held; badges and available totals remain truthful', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Ready'), saved('b', 200, 'Probation', { isOnHold: true })] });
  const ready = f.rows()[0], pending = f.rows()[1];
  assert.equal(holdButton(ready).textContent, 'Put On Hold');
  assert.equal(holdButton(pending).textContent, 'Release Hold');
  assert.equal(pending.part('.receipt-hold-badge').hidden, false);
  assert.equal(f.elements.availableCount.textContent, '2', 'held receipts remain Available');
  assert.match(f.elements.availableTotal.textContent, /300/);
  await f.click(f.elements.floatingAdd);
  const draft = f.rows().at(-1);
  assert.equal(holdButton(draft).disabled, true, 'the user must save a new receipt before toggling Hold');
  assert.equal(f.calls.hold.length, 0);
});

test('Hold toggles only one saved receipt and persists independently of receipt edits', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 200, 'Beta')] });
  const a = f.rows()[0];
  await f.click(holdButton(a));
  assert.equal(f.db.get('a').isOnHold, true);
  assert.equal(f.db.get('a').status, 'available');
  assert.equal(f.db.get('b').isOnHold, false);
  assert.equal(a.part('.receipt-hold-badge').hidden, false);
  assert.equal(holdButton(a).textContent, 'Release Hold');
  assert.equal(f.calls.hold.length, 1);
  assert.deepEqual([f.calls.create.length, f.calls.update.length, f.calls.consume.length], [0, 0, 0]);
  await f.click(holdButton(a));
  assert.equal(f.db.get('a').isOnHold, false);
  assert.equal(a.part('.receipt-hold-badge').hidden, true);
  assert.equal(holdButton(a).textContent, 'Put On Hold');
});

test('unsaved editor changes block Hold without discarding typed values', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha')] });
  const row = f.rows()[0];
  await f.type(row, 'amount', '125');
  await f.click(holdButton(row));
  assert.equal(f.calls.hold.length, 0);
  assert.equal(row.part('.receipt-amount').value, '125');
  assert.equal(f.db.get('a').amount, 100);
  assert.match(f.elements.encodingFeedback.textContent, /Save Receipt 1 before changing its Hold status/);
});

test('Manual Selection disables held cards and Select Shown skips them', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 200, 'Beta', { isOnHold: true })] });
  await manual(f);
  assert.equal(card(f, 'Alpha').part('.manual-select').disabled, false);
  assert.equal(card(f, 'Beta').part('.manual-select').disabled, true);
  assert.equal(card(f, 'Beta').part('.compact-hold-status').hidden, false);
  assert.match(card(f, 'Beta').part('.manual-select').attrs['aria-label'], /On Hold/);
  await f.click(f.elements.manualSelectShown);
  assert.equal(f.elements.manualSelectedCount.textContent, '1 of 100');
  assert.equal(card(f, 'Alpha').classList.contains('is-selected'), true);
  assert.equal(card(f, 'Beta').classList.contains('is-selected'), false);
});

test('Putting a manually selected receipt on Hold prunes selection and invalidates previous candidate membership', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 200, 'Beta')] });
  await manual(f);
  await card(f, 'Alpha').part('.manual-select').emit('change');
  assert.equal(f.elements.manualSelectedCount.textContent, '1 of 100');
  await f.click(holdButton(f.rows()[0]));
  assert.equal(f.elements.manualSelectedCount.textContent, '0 of 100');
  assert.equal(card(f, 'Alpha').part('.manual-select').disabled, true);
});

test('snapshot detects Hold set in another session and prevents workbook and Consumed transition', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 200, 'Beta')] });
  await manual(f);
  await card(f, 'Alpha').part('.manual-select').emit('change');
  f.db.set('a', { ...f.db.get('a'), isOnHold: true, updatedAt: f.stamp() });
  await f.click(f.elements.manualExportSelected);
  assert.equal(f.elements.exportConfirmModal.hidden, true);
  assert.match(f.elements.manualFeedback.textContent, /On Hold/);
  assert.deepEqual([f.calls.download.length, f.calls.consume.length], [0, 0]);
  assert.equal(f.db.get('a').status, 'available');
});

test('concurrent Hold after workbook preparation cannot consume any selected receipt', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha'), saved('b', 200, 'Beta')] });
  await manual(f);
  await card(f, 'Alpha').part('.manual-select').emit('change');
  await card(f, 'Beta').part('.manual-select').emit('change');
  await f.click(f.elements.manualExportSelected);
  assert.equal(f.elements.exportConfirmModal.hidden, false);
  f.fails.afterDownload = () => { f.db.set('b', { ...f.db.get('b'), isOnHold: true, updatedAt: f.stamp() }); };
  await f.click(f.elements.confirmExport);
  assert.equal(f.calls.download.length, 1, 'a workbook may already be prepared');
  assert.deepEqual([f.db.get('a').status, f.db.get('b').status], ['available', 'available'], 'database batch must be all-or-nothing');
  assert.match(f.elements.manualFeedback.textContent, /status update could not be confirmed/);
});

test('Hold state is never carried into a different signed-in user session after a delayed response', async () => {
  const f = await receiptFixture({ loaded: [saved('a', 100, 'Alpha')] });
  let release;
  f.fails.holdGate = new Promise(resolve => { release = resolve; });
  const clickPending = holdButton(f.rows()[0]).emit('click');
  await f.ui.loadForUser({ id: 'second-user' });
  release();
  await clickPending;
  assert.equal(f.rows()[0].dataset.receiptOnHold, '0', 'old async answer must not update the next user screen');
  assert.equal(f.elements.encodingFeedback.textContent.includes('placed On Hold'), false);
});

test('migration contains ownership checks and an atomic invoker RPC, not a privileged bypass', async () => {
  const sql = await readFile(new URL('../supabase/migrations/006_add_receipt_on_hold.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_on_hold boolean NOT NULL DEFAULT false/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.doesNotMatch(sql, /^\s*SECURITY DEFINER\b/m);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /r\.user_id = auth\.uid\(\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.consume_receipts_available_unheld/);
  assert.match(sql, /new\.status = 'consumed'/);
  assert.match(sql, /old\.is_on_hold/);
});
