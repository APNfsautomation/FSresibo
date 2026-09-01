import assert from 'node:assert/strict';
import test from 'node:test';
import { availableReceiptTotalCents, createReceiptDeleteHandler } from '../ui/receiptUi.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
};

const createFixture = ({ status = 'available', confirmAction, deleteReceipt } = {}) => {
  const trigger = { disabled: false };
  const nextSummary = { focusCount: 0, focus() { this.focusCount += 1; } };
  const fallbackFocus = { focusCount: 0, focus() { this.focusCount += 1; } };
  const row = {
    dataset: { receiptDbId: 'receipt-123' },
    nextElementSibling: { querySelector: selector => selector === 'summary' ? nextSummary : null },
    previousElementSibling: null,
    removed: false,
    remove() { this.removed = true; }
  };
  let sourceReceipts = [
    { dbId: 'receipt-123', status: 'available', cents: 10000 },
    { dbId: 'receipt-456', status: 'available', cents: 25000 }
  ];
  const calls = { confirmations: [], deletes: [], removeSource: [], clearSelection: 0, receiptIds: 0, encoding: 0, optimization: 0 };
  const feedback = { textContent: '' };
  let availableTotal = availableReceiptTotalCents(sourceReceipts);
  const handler = createReceiptDeleteHandler({
    row,
    triggerFallback: fallbackFocus,
    getCurrentUser: () => ({ id: 'user-1' }),
    getReceiptStatus: () => status,
    hasDraftContent: () => true,
    confirmAction: async options => {
      calls.confirmations.push(options);
      return confirmAction ? confirmAction(options) : true;
    },
    deleteReceipt: async id => {
      calls.deletes.push(id);
      if (deleteReceipt) return deleteReceipt(id);
    },
    removeStoreSourceReceipt: id => {
      calls.removeSource.push(id);
      sourceReceipts = sourceReceipts.filter(receipt => receipt.dbId !== id);
    },
    clearSelection: () => { calls.clearSelection += 1; },
    refreshReceiptIds: () => { calls.receiptIds += 1; },
    refreshEncodingCards: () => {
      calls.encoding += 1;
      availableTotal = availableReceiptTotalCents(sourceReceipts);
    },
    refreshOptimizationCards: () => { calls.optimization += 1; },
    setFeedback: (target, message = '') => { target.textContent = message; },
    feedbackTarget: feedback
  });
  return { trigger, nextSummary, fallbackFocus, row, calls, feedback, handler, availableTotal: () => availableTotal };
};

test('persisted Available delete survives async confirmation, executes once, and refreshes derived state', async () => {
  const confirmation = deferred();
  const fixture = createFixture({ confirmAction: () => confirmation.promise });
  const event = { currentTarget: fixture.trigger };
  const first = fixture.handler(event);
  const repeated = fixture.handler({ currentTarget: fixture.trigger });

  event.currentTarget = null;
  confirmation.resolve(true);
  await Promise.all([first, repeated]);

  assert.equal(fixture.calls.confirmations.length, 1);
  assert.equal(fixture.calls.confirmations[0].trigger, fixture.trigger);
  assert.equal(fixture.calls.confirmations[0].confirmLabel, 'Delete receipt');
  assert.deepEqual(fixture.calls.deletes, ['receipt-123']);
  assert.equal(fixture.row.removed, true);
  assert.deepEqual(fixture.calls.removeSource, ['receipt-123']);
  assert.equal(fixture.calls.clearSelection, 1);
  assert.equal(fixture.calls.receiptIds, 1);
  assert.equal(fixture.calls.encoding, 1);
  assert.equal(fixture.calls.optimization, 1);
  assert.equal(fixture.availableTotal(), 25000);
  assert.equal(fixture.nextSummary.focusCount, 1);
});

test('persisted delete cancellation makes no service call and leaves the receipt unchanged', async () => {
  const fixture = createFixture({ confirmAction: () => false });
  await fixture.handler({ currentTarget: fixture.trigger });

  assert.equal(fixture.calls.confirmations.length, 1);
  assert.equal(fixture.calls.deletes.length, 0);
  assert.equal(fixture.row.removed, false);
  assert.equal(fixture.availableTotal(), 35000);
  assert.equal(fixture.trigger.disabled, false);
  assert.equal(fixture.feedback.textContent, '');
});

test('delete error leaves the receipt coherent, clears pending state, and permits a successful retry', async () => {
  let attempts = 0;
  const fixture = createFixture({ deleteReceipt: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary database failure');
  } });

  await fixture.handler({ currentTarget: fixture.trigger });
  assert.equal(fixture.row.removed, false);
  assert.equal(fixture.trigger.disabled, false);
  assert.match(fixture.feedback.textContent, /Could not delete this receipt: temporary database failure/);
  assert.equal(fixture.availableTotal(), 35000);

  await fixture.handler({ currentTarget: fixture.trigger });
  assert.equal(attempts, 2);
  assert.deepEqual(fixture.calls.deletes, ['receipt-123', 'receipt-123']);
  assert.equal(fixture.row.removed, true);
  assert.equal(fixture.availableTotal(), 25000);
  assert.equal(fixture.feedback.textContent, '');
});

test('Consumed receipts cannot enter confirmation or direct-delete flow', async () => {
  const fixture = createFixture({ status: 'consumed' });
  await fixture.handler({ currentTarget: fixture.trigger });

  assert.equal(fixture.calls.confirmations.length, 0);
  assert.equal(fixture.calls.deletes.length, 0);
  assert.equal(fixture.row.removed, false);
  assert.equal(fixture.availableTotal(), 35000);
});
