// Issue #29: Receipt Optimization with more than 32 Available receipts, through the real receipt UI controller with an injected pool optimizer.
// Covers the visible states, progress, Cancel, the session/stale-result safeguards, over-budget honesty, and the unchanged export lifecycle.
import assert from 'node:assert/strict';
import test from 'node:test';
import { solvePoolOptimization } from '../services/poolOptimizationService.js';
import { createPoolOptimizerClient } from '../ui/poolOptimizerClient.js';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';

const id = index => `r${String(index + 1).padStart(3, '0')}`;
const saved = (index, amount, extra = {}) => ({ dbId: id(index), amount, store: `Store ${index + 1}`, receiptDate: '2026-08-01', ...extra });
const hundreds = (count, last) => [...Array.from({ length: count - 1 }, (_, i) => saved(i, 100)), saved(count - 1, last)];
const setStrategy = async (f, value) => { f.elements.optimizationStrategy.value = value; await f.elements.optimizationStrategy.emit('change'); };
const calculate = async (f, target, strategy = 'closest') => { await setStrategy(f, strategy); f.elements.target.value = target; await f.click(f.elements.calculate); };
const exportedIds = f => f.calls.download.flat().map(item => item.dbId);

// A pool optimizer the test controls: each run is held until the test settles it. resolveOnCancel false models a worker that finishes anyway.
function controlled({ resolveOnCancel = true } = {}) {
  const runs = [];
  return {
    runs,
    run(args) {
      const record = { args, cancelled: false, progress: fraction => args.onProgress?.(fraction) };
      record.promise = new Promise(resolve => { record.settle = resolve; });
      runs.push(record);
      return { promise: record.promise, cancel: () => { record.cancelled = true; if (resolveOnCancel) record.settle({ status: 'cancelled' }); } };
    }
  };
}
// A stand-in Worker that runs the real solver and speaks the real message protocol, so the page, client and solver are exercised together.
const solverWorker = () => () => {
  const worker = { terminated: false, onmessage: null, postMessage(data) { setImmediate(() => { if (worker.terminated) return; const outcome = solvePoolOptimization(Array.from(data.cents, cents => ({ cents })), data.target, data.strategy, { budget: data.budget, timeoutMs: data.timeoutMs }); worker.onmessage?.({ data: { type: 'done', id: data.id, outcome } }); }); }, terminate() { worker.terminated = true; } };
  return worker;
};
const inline = () => createPoolOptimizerClient({ createWorker: () => null }); // the real solver, run asynchronously on the page thread
const result = (total, items) => ({ status: 'exact', path: 'dp', result: { total, items } });
const busy = f => ({ disabled: f.elements.calculate.disabled, progressHidden: f.elements.calculationProgress.hidden, ariaBusy: f.elements.calculate.getAttribute('aria-busy') });

// ---- the UAT blocker: more than 32 Available receipts calculate, and the answer can depend on receipt #33 ----------------------------------------
test('33 Available receipts calculate for every strategy; a result that needs receipt #33 is found, reviewed, exported and Consumed exactly', async () => {
  for (const strategy of ['closest', 'fewest', 'without-exceeding']) {
    const f = await receiptFixture({ loaded: hundreds(33, 55.55), viaServiceMapping: true, poolOptimizer: inline() });
    await calculate(f, '55.55', strategy); await settle(); await settle();
    assert.doesNotMatch(f.elements.difference.textContent, /up to 32 receipts/i, strategy);
    assert.equal(f.elements.resultAmount.textContent.replace(/\s/g, ''), '₱55.55', strategy);
    assert.equal(f.elements.exportSelected.textContent, 'Export Selected (1)', strategy);
    await f.click(f.elements.exportSelected); await f.click(f.elements.confirmExport);
    assert.deepEqual(exportedIds(f), [id(32)], `${strategy}: the exported receipt is #33`);
    assert.deepEqual(f.calls.consume, [[id(32)]], `${strategy}: exactly that receipt is marked Consumed`);
    assert.equal(f.db.get(id(32)).status, 'consumed'); assert.equal(f.db.get(id(0)).status, 'available');
  }
});

test('a pool of 400 Available receipts calculates and the chosen receipts sum to the reported total', async () => {
  const loaded = Array.from({ length: 400 }, (_, i) => saved(i, 20 + (i * 37) % 480 + (i % 7) / 100));
  const f = await receiptFixture({ loaded, viaServiceMapping: true, poolOptimizer: createPoolOptimizerClient({ createWorker: solverWorker() }) });
  await calculate(f, '2000'); for (let i = 0; i < 40 && f.elements.calculate.disabled; i++) await settle();
  assert.equal(f.elements.calculate.disabled, false); assert.match(f.elements.resultTitle.textContent, /match/i);
  const shown = Math.round(Number(f.elements.resultAmount.textContent.replace(/[^0-9.]/g, '')) * 100);
  await f.click(f.elements.exportSelected); await f.click(f.elements.confirmExport);
  const total = f.calls.download[0].reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0);
  assert.ok(total >= 200000 && total <= 205000, `${total}`); assert.equal(shown, total);
});

test('the Available pool is every Available receipt, not the filtered view: a receipt hidden by search still takes part', async () => {
  const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: inline() });
  f.elements.optimizationSearch.value = 'Store 1'; await f.elements.optimizationSearch.emit('input'); await settle(); await settle();
  await calculate(f, '55.55'); await settle(); await settle();
  await f.click(f.elements.exportSelected); await f.click(f.elements.confirmExport);
  assert.deepEqual(exportedIds(f), [id(39)], 'receipt #40 is not visible under the search, and is still found');
});

test('pools of up to 32 receipts still calculate immediately and never use the pool optimizer', async () => {
  const optimizer = controlled();
  const f = await receiptFixture({ loaded: hundreds(32, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
  await calculate(f, '55.55');
  assert.equal(optimizer.runs.length, 0); assert.equal(f.elements.resultAmount.textContent.replace(/\s/g, ''), '₱55.55'); assert.equal(f.elements.calculate.disabled, false);
});

// ---- visible state, progress and Cancel ----------------------------------------------------------------------------------------------------------
test('while a long pool calculates the page shows busy state, real progress and a Cancel button, and nothing is exportable', async () => {
  const optimizer = controlled(); const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
  await calculate(f, '55.55');
  assert.deepEqual(busy(f), { disabled: true, progressHidden: false, ariaBusy: 'true' });
  assert.match(f.elements.resultTitle.textContent, /Calculating/); assert.equal(f.elements.exportSelected.disabled, true);
  assert.deepEqual(optimizer.runs[0].args.cents.length, 40, 'all 40 Available receipts are sent');
  optimizer.runs[0].progress(0.37);
  assert.equal(f.elements.calculationProgressBar.value, 37); assert.match(f.elements.calculationProgressText.textContent, /37%/);
  optimizer.runs[0].progress(0.39); assert.match(f.elements.calculationProgressText.textContent, /37%/, 'announcements change in 10% steps only');
  optimizer.runs[0].settle(result(5555, [39])); await settle();
  assert.deepEqual(busy(f), { disabled: false, progressHidden: true, ariaBusy: null }); assert.equal(f.elements.exportSelected.textContent, 'Export Selected (1)');
  assert.equal(f.elements.calculationProgressText.textContent, '');
});

test('Cancel stops the calculation, says so, restores the page, and a late answer from the stopped run changes nothing', async () => {
  const optimizer = controlled({ resolveOnCancel: false }); const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
  await calculate(f, '55.55');
  await f.click(f.elements.cancelCalculation);
  assert.equal(optimizer.runs[0].cancelled, true); assert.deepEqual(busy(f), { disabled: false, progressHidden: true, ariaBusy: null });
  assert.match(f.elements.difference.textContent, /Calculation cancelled\. No recommendation was produced\./);
  optimizer.runs[0].progress(0.9); assert.equal(f.elements.calculationProgressBar.value, 0, 'stale progress is ignored');
  optimizer.runs[0].settle(result(5555, [39])); await settle();
  assert.equal(f.elements.exportSelected.disabled, true); assert.match(f.elements.difference.textContent, /cancelled/); assert.doesNotMatch(f.elements.resultTitle.textContent, /match found|Best/);
});

test('focus moves to Cancel when the calculation starts and returns to Find best match afterwards', async () => {
  const optimizer = controlled(); const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
  f.elements.calculate.focus(); await calculate(f, '55.55');
  assert.equal(document.activeElement, f.elements.cancelCalculation);
  optimizer.runs[0].settle(result(5555, [39])); await settle();
  assert.equal(document.activeElement, f.elements.calculate);
});

// ---- stale results: every invalidation, and the late answer is never applied -----------------------------------------------------------------------
async function stale(mutate, expectedMessage = /stopped because your receipts or settings changed/) {
  const optimizer = controlled({ resolveOnCancel: false }); const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
  await calculate(f, '55.55');
  await mutate(f, optimizer);
  assert.equal(optimizer.runs[0].cancelled, true, 'the worker is told to stop');
  assert.deepEqual(busy(f), { disabled: false, progressHidden: true, ariaBusy: null });
  assert.match(f.elements.difference.textContent, expectedMessage);
  optimizer.runs[0].settle(result(5555, [39])); await settle();
  assert.equal(f.elements.exportSelected.disabled, true, 'a late answer is not applied'); assert.match(f.elements.difference.textContent, expectedMessage);
  assert.deepEqual([f.calls.create.length, f.calls.update.length, f.calls.consume.length, f.calls.download.length], [0, 0, 0, 0]);
  return f;
}
test('editing a receipt amount during the calculation stops it and discards the late answer', () => stale(async f => { await f.type(f.rows()[3], 'amount', '101'); }));
test('changing the target or the strategy during the calculation stops it', async () => {
  await stale(async f => { f.elements.target.value = '60'; await f.elements.target.emit('input'); });
  await stale(async f => { await setStrategy(f, 'fewest'); });
});
test('a later calculation silently supersedes the earlier one', async () => {
  const optimizer = controlled({ resolveOnCancel: false }); const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
  await calculate(f, '55.55'); await f.click(f.elements.calculate.disabled ? f.elements.cancelCalculation : f.elements.calculate);
  await calculate(f, '55.55'); await calculate(f, '55.55');
  assert.ok(optimizer.runs.length >= 2); assert.equal(optimizer.runs.slice(0, -1).every(run => run.cancelled), true, 'every earlier run was cancelled');
  optimizer.runs[0].settle(result(5555, [0])); await settle(); assert.equal(f.elements.calculate.disabled, true, 'only the newest run is still pending');
  optimizer.runs.at(-1).settle(result(5555, [39])); await settle();
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (1)');
});
test('a pool change that bypasses the input events is still caught by the pool signature before any result is applied', async () => {
  const optimizer = controlled(); const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
  await calculate(f, '55.55');
  f.field(f.rows()[5], 'amount').value = '999'; // no event: only the signature can notice
  optimizer.runs[0].settle(result(5555, [39])); await settle();
  assert.match(f.elements.difference.textContent, /receipts or settings changed/); assert.equal(f.elements.exportSelected.disabled, true);
});
test('a status change during the calculation (another receipt becomes Consumed) discards the answer', async () => {
  const optimizer = controlled(); const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
  await calculate(f, '55.55');
  f.rows()[7].dataset.receiptStatus = 'consumed';
  optimizer.runs[0].settle(result(5555, [39])); await settle();
  assert.equal(f.elements.exportSelected.disabled, true);
});
test('signing out stops the calculation and a late answer never appears for the next account', async () => {
  const optimizer = controlled({ resolveOnCancel: false }); const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
  await calculate(f, '55.55'); f.ui.clearForLogout();
  assert.equal(optimizer.runs[0].cancelled, true); assert.equal(f.elements.calculate.disabled, false);
  await f.ui.loadForUser({ id: 'user-2' });
  optimizer.runs[0].settle(result(5555, [39])); await settle();
  assert.equal(f.elements.exportSelected.disabled, true); assert.doesNotMatch(f.elements.resultTitle.textContent, /match found|Best/);
});
test('switching straight to another account stops the calculation silently and starts that account clean', async () => {
  const optimizer = controlled({ resolveOnCancel: false }); const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
  await calculate(f, '55.55'); await f.ui.loadForUser({ id: 'user-2' });
  assert.equal(optimizer.runs[0].cancelled, true); assert.deepEqual(busy(f), { disabled: false, progressHidden: true, ariaBusy: null });
  optimizer.runs[0].settle(result(5555, [39])); await settle();
  assert.equal(f.elements.exportSelected.disabled, true);
});
test('leaving Receipt Optimization for another module stops the calculation', () => stale(async f => { f.ui.setModuleVisible(false); }, /stopped when you left Receipt Optimization/));

// ---- truthful over-budget, timeout and failure states ----------------------------------------------------------------------------------------------
test('an over-budget pool says no recommendation can be computed safely, changes nothing, and never suggests exporting to shrink the pool', async () => {
  const f = await receiptFixture({ loaded: Array.from({ length: 400 }, (_, i) => saved(i, 5000 + i * 0.07)), viaServiceMapping: true, poolOptimizer: createPoolOptimizerClient() });
  await calculate(f, '1000000'); await settle();
  assert.equal(f.elements.difference.textContent, 'Exact result cannot be computed safely with these values on this device; no recommendation was produced.');
  assert.equal(f.elements.resultTitle.textContent, 'No recommendation'); assert.equal(f.elements.resultAmount.textContent, '₱0.00');
  assert.match(f.elements.adminContent.textContent, /Searching all 400 Available receipts exactly would need about [\d,]+ million steps and [\d,]+ MB/);
  assert.match(f.elements.adminContent.textContent, /Your receipts were not changed/);
  assert.doesNotMatch(`${f.elements.difference.textContent} ${f.elements.adminContent.textContent}`, /export|consume|manual selection/i);
  assert.equal(f.elements.exportSelected.disabled, true); assert.deepEqual([f.calls.create.length, f.calls.update.length, f.calls.consume.length, f.calls.download.length], [0, 0, 0, 0]);
  assert.equal(f.rows().length, 400, 'every Available receipt is still there'); assert.equal(busy(f).disabled, false);
});
test('timeout, error and unavailable outcomes each end with a clear no-recommendation message and a usable page', async () => {
  for (const [outcome, pattern] of [[{ status: 'timeout' }, /took too long and was stopped\. No recommendation/], [{ status: 'error', message: 'boom' }, /could not be completed\. No recommendation/], [{ status: 'unavailable', plan: { receipts: 40, cells: 1e9, bytes: 3e8 } }, /cannot run the background calculation/]]) {
    const optimizer = controlled(); const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
    await calculate(f, '55.55'); optimizer.runs[0].settle(outcome); await settle();
    assert.match(f.elements.difference.textContent, pattern); assert.equal(f.elements.exportSelected.disabled, true); assert.equal(busy(f).disabled, false);
  }
});
test('an exact "nothing qualifies" answer keeps the existing no-match wording', async () => {
  const optimizer = controlled(); const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: optimizer });
  await calculate(f, '55.55'); optimizer.runs[0].settle({ status: 'exact', path: 'dp', result: null }); await settle();
  assert.equal(f.elements.resultTitle.textContent, 'No valid match found');
});

// ---- the export lifecycle is unchanged ---------------------------------------------------------------------------------------------------------------
test('a long-pool result goes through the same review, snapshot checks and Consumed rules: a receipt Consumed elsewhere blocks the export', async () => {
  const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: inline() });
  await calculate(f, '55.55'); await settle(); await settle();
  assert.equal(f.elements.exportSelected.textContent, 'Export Selected (1)');
  f.db.set(id(39), { ...f.db.get(id(39)), status: 'consumed', updatedAt: f.stamp() }); // another session consumed it
  await f.click(f.elements.exportSelected); await f.click(f.elements.confirmExport);
  assert.equal(f.calls.download.length, 0, 'nothing was generated'); assert.deepEqual(f.calls.consume, [], 'nothing was consumed');
});
test('unsaved edited amounts may take part in a long-pool calculation but still block the export, exactly as for small pools', async () => {
  const f = await receiptFixture({ loaded: hundreds(40, 55.55), viaServiceMapping: true, poolOptimizer: inline() });
  await f.type(f.rows()[10], 'amount', '77.77');
  await calculate(f, '77.77'); await settle(); await settle();
  assert.equal(f.elements.resultAmount.textContent.replace(/\s/g, ''), '₱77.77');
  await f.click(f.elements.exportSelected); await f.click(f.elements.confirmExport);
  assert.equal(f.calls.download.length, 0); assert.equal(f.calls.update.length + f.calls.create.length, 0, 'calculating and the refused export wrote nothing');
});
