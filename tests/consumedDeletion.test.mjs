import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createConsumedDeleteHandler } from '../ui/receiptUi.js';

const deferred = () => { let resolve; const promise = new Promise(next => { resolve = next; }); return { promise, resolve }; };

const createFixture = ({ status = 'consumed', dbId = 'receipt-9', user = { id: 'user-1' }, confirmAction, deleteConsumedReceipt, nextHidden = false } = {}) => {
  const trigger = { disabled: false };
  const nextSummary = { focusCount: 0, focus() { this.focusCount += 1; } };
  const previousSummary = { focusCount: 0, focus() { this.focusCount += 1; } };
  const fallback = { focusCount: 0, focus() { this.focusCount += 1; } };
  const row = {
    dataset: dbId ? { receiptDbId: dbId } : {},
    nextElementSibling: { hidden: nextHidden, nextElementSibling: null, querySelector: selector => selector === 'summary' ? nextSummary : null },
    previousElementSibling: { hidden: false, previousElementSibling: null, querySelector: selector => selector === 'summary' ? previousSummary : null },
    removed: false,
    remove() { this.removed = true; }
  };
  const calls = { confirmations: [], deletes: [], removeSource: [], clearSelection: 0, receiptIds: 0, encoding: 0, optimization: 0, feedback: [] };
  const feedback = { textContent: '', dataset: {} };
  const handler = createConsumedDeleteHandler({
    row,
    triggerFallback: fallback,
    getCurrentUser: () => user,
    getReceiptStatus: () => status,
    confirmAction: async options => { calls.confirmations.push(options); return confirmAction ? confirmAction(options) : true; },
    deleteConsumedReceipt: async id => { calls.deletes.push({ id, rowRemovedAtCall: row.removed }); if (deleteConsumedReceipt) return deleteConsumedReceipt(id); },
    removeStoreSourceReceipt: id => { calls.removeSource.push(id); },
    clearSelection: () => { calls.clearSelection += 1; },
    refreshReceiptIds: () => { calls.receiptIds += 1; },
    refreshEncodingCards: () => { calls.encoding += 1; },
    refreshOptimizationCards: () => { calls.optimization += 1; },
    setFeedback: (target, message = '', severity = '') => { target.textContent = message; if (message && severity) target.dataset.severity = severity; else delete target.dataset.severity; calls.feedback.push([message, severity]); },
    feedbackTarget: feedback
  });
  return { trigger, nextSummary, previousSummary, fallback, row, calls, feedback, handler };
};

test('a confirmed Consumed deletion warns it is permanent, deletes once, and removes the row only after the database confirmed', async () => {
  const database = deferred();
  const fixture = createFixture({ deleteConsumedReceipt: () => database.promise });
  const first = fixture.handler({ currentTarget: fixture.trigger });
  const repeated = fixture.handler({ currentTarget: fixture.trigger });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(fixture.row.removed, false, 'the row is not removed while the deletion is unconfirmed');
  assert.equal(fixture.trigger.disabled, true, 'the control is disabled while the request is in flight');
  database.resolve();
  await Promise.all([first, repeated]);
  assert.equal(fixture.calls.confirmations.length, 1);
  const [confirmation] = fixture.calls.confirmations;
  assert.equal(confirmation.danger, true); assert.equal(confirmation.confirmLabel, 'Delete permanently'); assert.equal(confirmation.cancelLabel, 'Keep receipt'); assert.equal(confirmation.trigger, fixture.trigger);
  assert.match(confirmation.message, /permanent/i); assert.match(confirmation.message, /cannot be undone/i);
  assert.deepEqual(fixture.calls.deletes, [{ id: 'receipt-9', rowRemovedAtCall: false }], 'a single call, made before the row was touched');
  assert.equal(fixture.row.removed, true); assert.deepEqual(fixture.calls.removeSource, ['receipt-9']);
  assert.deepEqual([fixture.calls.clearSelection, fixture.calls.receiptIds, fixture.calls.encoding, fixture.calls.optimization], [1, 1, 1, 1], 'selection, numbering, filters, counts and optimization are refreshed');
  assert.deepEqual(fixture.calls.feedback.at(-1), ['Consumed receipt deleted permanently.', 'success']);
  assert.equal(fixture.nextSummary.focusCount, 1, 'focus moves to the next visible receipt'); assert.equal(fixture.trigger.disabled, false);
});

test('focus falls back to the previous visible receipt, then to the View receipts control', async () => {
  const hiddenNext = createFixture({ nextHidden: true });
  await hiddenNext.handler({ currentTarget: hiddenNext.trigger });
  assert.equal(hiddenNext.nextSummary.focusCount, 0); assert.equal(hiddenNext.previousSummary.focusCount, 1);
  const alone = createFixture();
  alone.row.nextElementSibling = null; alone.row.previousElementSibling = null;
  await alone.handler({ currentTarget: alone.trigger });
  assert.equal(alone.fallback.focusCount, 1);
});

test('cancelling leaves the receipt, the lists and the database untouched', async () => {
  const fixture = createFixture({ confirmAction: async () => false });
  await fixture.handler({ currentTarget: fixture.trigger });
  assert.deepEqual(fixture.calls.deletes, []); assert.equal(fixture.row.removed, false);
  assert.deepEqual([fixture.calls.removeSource.length, fixture.calls.clearSelection, fixture.calls.encoding, fixture.calls.feedback.length], [0, 0, 0, 0]);
  assert.equal(fixture.trigger.disabled, false);
});

test('a failed, rejected or unconfirmed deletion keeps the row and reports an error instead of success', async () => {
  for (const failure of [new Error('Network down.'), new Error('The receipt is no longer Consumed (or no longer exists), so it was not deleted. Refresh to see its current status.')]) {
    const fixture = createFixture({ deleteConsumedReceipt: async () => { throw failure; } });
    await fixture.handler({ currentTarget: fixture.trigger });
    assert.equal(fixture.row.removed, false); assert.deepEqual(fixture.calls.removeSource, []);
    assert.deepEqual([fixture.calls.clearSelection, fixture.calls.receiptIds, fixture.calls.encoding, fixture.calls.optimization], [0, 0, 0, 0]);
    assert.equal(fixture.feedback.dataset.severity, 'error');
    assert.equal(fixture.feedback.textContent, `Could not delete this Consumed receipt: ${failure.message.replace(/\.$/, '')}. It was not removed from your list.`);
    assert.equal(fixture.trigger.disabled, false, 'retry is possible');
  }
});

test('only a saved receipt that is currently Consumed for a signed-in user can be deleted this way', async () => {
  for (const options of [{ status: 'available' }, { dbId: '' }, { user: null }]) {
    const fixture = createFixture(options);
    await fixture.handler({ currentTarget: fixture.trigger });
    assert.deepEqual(fixture.calls.confirmations, [], JSON.stringify(options)); assert.deepEqual(fixture.calls.deletes, []); assert.equal(fixture.row.removed, false);
  }
});

test('the service deletes by id restricted to the CURRENT Consumed status and requires exactly one deleted row', async () => {
  const source = (await readFile(new URL('../services/receiptService.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const body = source.slice(source.indexOf('export async function deleteConsumedReceipt'), source.indexOf('export async function updateReceiptStatus'));
  assert.match(body, /\.from\('receipts'\)\.delete\(\)\.eq\('id', id\)\.eq\('status', 'consumed'\)\.select\('id'\)/);
  const run = async (client, id = 'r1') => new Function('clientOrThrow', `${body.replace('export async function', 'async function')}; return deleteConsumedReceipt;`)(async () => client)(id);
  const calls = [];
  const client = rows => ({ from: table => { calls.push(['from', table]); const chain = { delete: () => { calls.push(['delete']); return chain; }, eq: (column, value) => { calls.push(['eq', column, value]); return chain; }, select: column => { calls.push(['select', column]); return Promise.resolve(rows); } }; return chain; } });
  await run(client({ data: [{ id: 'r1' }], error: null }));
  assert.deepEqual(calls, [['from', 'receipts'], ['delete'], ['eq', 'id', 'r1'], ['eq', 'status', 'consumed'], ['select', 'id']]);
  await assert.rejects(run(client({ data: [], error: null })), /no longer Consumed .* not deleted/, 'a receipt restored to Available meanwhile deletes zero rows: treated as not deleted');
  await assert.rejects(run(client({ data: [{ id: 'r1' }, { id: 'r2' }], error: null })), /not deleted/, 'anything but exactly one row is not trusted');
  await assert.rejects(run(client({ data: null, error: null })), /not deleted/, 'an empty or uncertain response is not success');
  await assert.rejects(run(client({ data: null, error: new Error('permission denied') })), /permission denied/);
  await assert.rejects(run(client({ data: [{ id: 'r1' }], error: null }), ''), /saved receipt is required/);
});

test('Available deletion and bulk behaviour are unchanged: no bulk Consumed delete exists and the plain delete path is intact', async () => {
  const service = await readFile(new URL('../services/receiptService.js', import.meta.url), 'utf8');
  assert.match(service, /export async function deleteReceipt\(id\) \{[\s\S]*?\.delete\(\)\.eq\('id', id\)/);
  assert.equal((service.match(/\.delete\(\)/g) ?? []).length, 2, 'exactly the Available delete and the single Consumed delete');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /delete all consumed|clear consumed|Delete all/i);
});
