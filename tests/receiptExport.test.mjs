import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExpenseDetailedReportRows } from '../services/exportService.js';
import { createReceiptExportRunner, exportRowFromSnapshot, preflightExport, preflightMessage, snapshotProblemMessage, unsavedValuesNotice } from '../ui/receiptExport.js';

const row = (dbId, extra = {}) => ({ dbId, status: 'available', amount: 100, receiptDate: '2026-08-03', store: `Store ${dbId}`, address: '', tin: '', vat: '', invoice: '', updatedAt: 't1', ...extra });
const entries = ids => ids.map(id => ({ dbId: id, label: `Receipt ${id.slice(1)}` }));

function setup({ rows = [row('r1'), row('r2')], consume, generate } = {}) {
  const state = { rows: new Map(rows.map(item => [item.dbId, item])), reads: [], generated: [], consumed: [] };
  const runner = createReceiptExportRunner({
    fetchSnapshot: async ids => { state.reads.push(ids); return ids.filter(id => state.rows.has(id)).map(id => ({ ...state.rows.get(id) })); },
    generateWorkbook: generate ?? (exportRows => { state.generated.push(exportRows); }),
    consume: consume ?? (async ids => { state.consumed.push(ids); return ids.map(id => { const next = { ...state.rows.get(id), status: 'consumed', updatedAt: 't2' }; state.rows.set(id, next); return { ...next }; }); })
  });
  return { state, runner };
}

test('preflight blocks drafts, unsaved edits, unavailable receipts and invalid amounts, and names each one', () => {
  const result = preflightExport([
    { label: 'Receipt 1', dbId: 'r1', present: true, status: 'available', unsaved: false, amountProblem: '' },
    { label: 'Receipt 2', dbId: null, present: true, status: 'available', unsaved: true, amountProblem: '' },
    { label: 'Receipt 3', dbId: 'r3', present: true, status: 'available', unsaved: true, amountProblem: '' },
    { label: 'Receipt 4', dbId: 'r4', present: true, status: 'consumed', unsaved: false, amountProblem: '' },
    { label: 'Receipt 5', dbId: 'r5', present: true, status: 'available', unsaved: false, amountProblem: 'Invalid amount "x".' },
    { label: 'Receipt 6', dbId: null, savedSinceResult: true, present: true, status: 'available', unsaved: false, amountProblem: '' }
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.map(({ type, label }) => [type, label]), [['draft', 'Receipt 2'], ['unsaved', 'Receipt 3'], ['unavailable', 'Receipt 4'], ['invalidAmount', 'Receipt 5'], ['resultStale', 'Receipt 6']]);
  const message = preflightMessage(result.problems);
  assert.match(message, /Receipt 2 has not been saved\. Save it before exporting and run Find Best Match again\./);
  assert.match(message, /Receipt 3 has unsaved changes\. Save them in Encoding/);
  assert.match(message, /Receipt 5: Invalid amount "x"\. Correct it before exporting\./);
  assert.match(message, /Receipt 4 is no longer Available/);
  assert.match(message, /Receipt 6 was saved after Find Best Match ran/);
  assert.match(message, /Nothing was exported\.$/);
});

test('preflight passes saved, unchanged, Available receipts with valid amounts', () => {
  assert.deepEqual(preflightExport([{ label: 'Receipt 1', dbId: 'r1', present: true, status: 'available', unsaved: false, amountProblem: '' }]), { ok: true, problems: [] });
  assert.equal(preflightExport([{ label: 'Receipt 9', dbId: 'r9', present: false, status: 'consumed' }]).ok, false, 'a receipt that is no longer on screen cannot be exported');
});

test('problem messages say what changed and what to do, for review and for confirmation', () => {
  const problems = [{ type: 'missing', label: 'Receipt 1' }, { type: 'unavailable', label: 'Receipt 2' }, { type: 'optimizerChanged', label: 'Receipt 3' }, { type: 'changed', label: 'Receipt 4', fields: ['store', 'amount', 'updatedAt'] }];
  const review = snapshotProblemMessage(problems);
  assert.match(review, /Receipt 1 no longer exists/);
  assert.match(review, /Receipt 2 is no longer Available \(already Consumed in another session\)/);
  assert.match(review, /saved amount of Receipt 3 no longer matches the amount Find Best Match used/);
  assert.match(review, /Receipt 4 was changed after it was selected \(Store name, Amount and Last updated\)/);
  assert.match(review, /Nothing was exported\. Run Find Best Match again\.$/);
  assert.match(snapshotProblemMessage(problems, { stage: 'confirm' }), /No workbook was prepared and nothing was marked Consumed\./);
});

test('the unsaved-values notice separates "used in the calculation" from "part of the selected result"', () => {
  assert.equal(unsavedValuesNotice({}), '');
  assert.equal(unsavedValuesNotice({ considered: [] , selected: [] }), '');
  const considered = unsavedValuesNotice({ considered: ['Receipt 3'] });
  assert.match(considered, /also used unsaved values for Receipt 3; none of them is in the selected result/);
  assert.doesNotMatch(considered, /selected result includes/);
  const selected = unsavedValuesNotice({ selected: ['Receipt 2'], considered: ['Receipt 2', 'Receipt 3'] });
  assert.match(selected, /selected result includes Receipt 2 with unsaved values\. Save it in Encoding and run Find Best Match again/);
  assert.match(selected, /Unsaved values were also used for Receipt 3\./);
});

test('workbook rows come from the saved snapshot; blank stays blank, zero stays numeric zero, amounts keep exact centavos', () => {
  const exportRows = [row('r1', { amount: '' }), row('r2', { amount: 0 }), row('r3', { amount: 1250.5 }), row('r4', { amount: 100 })].map(exportRowFromSnapshot);
  assert.deepEqual(exportRows.map(item => item.amount), ['', '0.00', '1250.50', '100.00']);
  assert.deepEqual(buildExpenseDetailedReportRows(exportRows).slice(2).map(line => line[7]), [null, 0, 1250.5, 100]);
});

test('a valid export reads a second snapshot, builds the workbook from it in the given order, then marks the receipts Consumed', async () => {
  const { state, runner } = setup({ rows: [row('r1'), row('r2'), row('r3')] });
  const baseline = await runner.loadBaseline(['r3', 'r1']);
  const result = await runner.run({ entries: entries(['r3', 'r1']), baseline });
  assert.equal(result.state, 'consumed');
  assert.equal(state.reads.length, 2, 'Snapshot A and Snapshot B');
  assert.deepEqual(state.generated[0].map(item => item.dbId), ['r3', 'r1'], 'the exact order the caller gave');
  assert.deepEqual(state.generated[0].map(item => item.store), ['Store r3', 'Store r1'], 'database values');
  assert.deepEqual(state.consumed, [['r3', 'r1']]);
  assert.deepEqual(result.drift, []);
  assert.equal(runner.isPending(), false);
});

test('workbook generation happens strictly before the status update', async () => {
  const order = [];
  const { runner } = setup({ generate: () => { order.push('generate'); }, consume: async ids => { order.push('consume'); return ids.map(id => row(id, { status: 'consumed' })); } });
  await runner.run({ entries: entries(['r1']), baseline: await runner.loadBaseline(['r1']) });
  assert.deepEqual(order, ['generate', 'consume']);
});

test('a change between Snapshot A and Snapshot B blocks the export: nothing is generated or consumed', async () => {
  const { state, runner } = setup();
  const baseline = await runner.loadBaseline(['r1', 'r2']);
  state.rows.set('r2', row('r2', { invoice: 'CHANGED', updatedAt: 't5' }));
  const result = await runner.run({ entries: entries(['r1', 'r2']), baseline });
  assert.equal(result.state, 'blocked');
  assert.deepEqual(result.problems, [{ type: 'changed', dbId: 'r2', label: 'Receipt 2', fields: ['invoice', 'updatedAt'] }]);
  assert.equal(state.generated.length, 0); assert.equal(state.consumed.length, 0);
});

test('a receipt consumed or deleted between the snapshots blocks the export', async () => {
  for (const mutate of [state => state.rows.set('r1', row('r1', { status: 'consumed' })), state => state.rows.delete('r1')]) {
    const { state, runner } = setup();
    const baseline = await runner.loadBaseline(['r1']);
    mutate(state);
    const result = await runner.run({ entries: entries(['r1']), baseline });
    assert.equal(result.state, 'blocked');
    assert.equal(state.generated.length + state.consumed.length, 0);
  }
});

test('a failed Snapshot B read exports nothing', async () => {
  const state = { generated: 0, consumed: 0 }; let reads = 0;
  const runner = createReceiptExportRunner({ fetchSnapshot: async ids => { if (++reads === 2) throw new Error('offline'); return ids.map(id => row(id)); }, generateWorkbook: () => { state.generated += 1; }, consume: async () => { state.consumed += 1; return []; } });
  const result = await runner.run({ entries: entries(['r1']), baseline: await runner.loadBaseline(['r1']) });
  assert.equal(result.state, 'snapshot-failed'); assert.equal(result.error.message, 'offline');
  assert.deepEqual(state, { generated: 0, consumed: 0 });
});

test('workbook generation failure marks nothing Consumed', async () => {
  const { state, runner } = setup({ generate: () => { throw new Error('disk full'); } });
  const result = await runner.run({ entries: entries(['r1', 'r2']), baseline: await runner.loadBaseline(['r1', 'r2']) });
  assert.equal(result.state, 'generation-failed'); assert.equal(result.error.message, 'disk full');
  assert.equal(state.consumed.length, 0);
  assert.equal(runner.isPending(), false, 'the runner can be used again');
  assert.deepEqual(runner.uncertainIds(), []);
});

test('a status update failure after generation is reported as uncertain and a retry needs a fresh baseline', async () => {
  let fail = true;
  const { state, runner } = setup({ consume: async ids => { if (fail) throw new Error('network down'); return ids.map(id => row(id, { status: 'consumed' })); } });
  const stale = await runner.loadBaseline(['r1', 'r2']);
  const failed = await runner.run({ entries: entries(['r1', 'r2']), baseline: stale });
  assert.equal(failed.state, 'consume-failed'); assert.equal(failed.error.message, 'network down');
  assert.deepEqual(failed.exportRows.map(item => item.dbId), ['r1', 'r2'], 'what was exported is kept for investigation');
  assert.equal(state.generated.length, 1);
  assert.deepEqual(runner.uncertainIds(), ['r1', 'r2']);
  fail = false;
  const reused = await runner.run({ entries: entries(['r1', 'r2']), baseline: stale });
  assert.equal(reused.state, 'verification-required', 'the old review cannot be reused');
  assert.equal(state.generated.length, 1, 'no second workbook');
  const fresh = await runner.loadBaseline(['r1', 'r2']);
  assert.deepEqual(runner.uncertainIds(), ['r1', 'r2'], 'still Available in the database, so still uncertain: the caller must warn');
  assert.equal((await runner.run({ entries: entries(['r1', 'r2']), baseline: fresh })).state, 'consumed');
  assert.deepEqual(runner.uncertainIds(), []);
});

test('fresh verification clears the uncertainty for receipts the database shows as Consumed, and a retry for them is blocked', async () => {
  const { state, runner } = setup({ consume: async () => { throw new Error('timeout'); } });
  await runner.run({ entries: entries(['r1', 'r2']), baseline: await runner.loadBaseline(['r1', 'r2']) });
  state.rows.set('r1', row('r1', { status: 'consumed' }));
  const baseline = await runner.loadBaseline(['r1', 'r2']);
  assert.deepEqual(runner.uncertainIds(), ['r2'], 'the update did reach r1');
  const retry = await runner.run({ entries: entries(['r1', 'r2']), baseline });
  assert.equal(retry.state, 'blocked');
  assert.deepEqual(retry.problems.map(problem => [problem.type, problem.dbId]), [['unavailable', 'r1']]);
  assert.equal(state.generated.length, 1);
});

test('concurrent confirmations start one export only', async () => {
  const { state, runner } = setup();
  const baseline = await runner.loadBaseline(['r1']);
  const [first, second] = await Promise.all([runner.run({ entries: entries(['r1']), baseline }), runner.run({ entries: entries(['r1']), baseline })]);
  assert.deepEqual([first.state, second.state].sort(), ['busy', 'consumed']);
  assert.equal(state.generated.length, 1); assert.equal(state.consumed.length, 1);
});

test('values the database returns after the status update are compared with what was exported', async () => {
  const { runner } = setup({ consume: async ids => ids.map(id => row(id, { status: 'consumed', store: id === 'r2' ? 'Edited meanwhile' : `Store ${id}` })) });
  const result = await runner.run({ entries: entries(['r1', 'r2']), baseline: await runner.loadBaseline(['r1', 'r2']) });
  assert.equal(result.state, 'consumed');
  assert.deepEqual(result.drift, [{ dbId: 'r2', fields: ['store'] }]);
});
