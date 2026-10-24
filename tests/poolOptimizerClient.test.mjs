// Issue #29: the page-side runner (ui/poolOptimizerClient.js), the module Worker (services/poolOptimizationWorker.js) and the markup that shows progress.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPoolOptimizerClient, mainThreadFallbackCells } from '../ui/poolOptimizerClient.js';
import { poolBudget, solvePoolOptimization } from '../services/poolOptimizationService.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const amounts = count => Array.from({ length: count }, (_, i) => 3000 + i * 13);
// Fake timers and a fake Worker so every path is deterministic.
function harness(options = {}) {
  const timers = []; const workers = [];
  const setTimer = (callback, delay) => { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; };
  const clearTimer = timer => { if (timer) timer.cleared = true; };
  const createWorker = options.createWorker ?? (() => { const worker = { posted: [], terminated: 0, postMessage(message) { worker.posted.push(message); }, terminate() { worker.terminated++; } }; workers.push(worker); return worker; });
  return { timers, workers, client: createPoolOptimizerClient({ createWorker, setTimer, clearTimer, timeoutMs: 1000, watchdogGraceMs: 500, ...options.client }) };
}
const run = (h, cents, target = 100000, strategy = 'closest', onProgress) => h.client.run({ cents, target, strategy, onProgress });

test('an over-budget pool is refused by the preflight before any Worker is created or any data is sent', async () => {
  const h = harness({ createWorker: () => { throw new Error('must not be called'); } });
  const outcome = await run(h, Array.from({ length: 400 }, (_, i) => 500000 + i * 7), 100_000_000).promise;
  assert.equal(outcome.status, 'over-budget'); assert.equal(outcome.plan.reason, 'work'); assert.ok(outcome.plan.cells > poolBudget.maxCells);
});

test('invalid input ends as an error outcome (the promise never rejects) and no Worker starts', async () => {
  const h = harness();
  assert.deepEqual((await run(h, [...amounts(40), -5], 1000).promise).status, 'error');
  assert.equal((await run(h, amounts(40), 0).promise).status, 'error'); assert.equal(h.workers.length, 0);
});

test('cheap paths (up to 32 receipts, a target above the pool) are computed directly without a Worker', async () => {
  const h = harness();
  const small = await run(h, [4000, 6000, 2500], 10000).promise;
  assert.deepEqual([small.status, small.path, small.result], ['exact', 'engine', { total: 10000, items: [0, 1] }]);
  const above = await run(h, amounts(60), 1e9).promise;
  assert.deepEqual([above.status, above.path, above.result.items.length], ['exact', 'all-positive', 60]); assert.equal(h.workers.length, 0);
});

test('a long pool runs in a Worker: the start message carries only amounts, progress is forwarded, the answer resolves once, and the Worker is terminated', async () => {
  const h = harness(); const progress = [];
  const job = run(h, amounts(60), 100000, 'fewest', fraction => progress.push(fraction));
  const [worker] = h.workers; assert.equal(worker.posted.length, 1);
  const start = worker.posted[0];
  assert.equal(start.type, 'start'); assert.ok(start.cents instanceof Float64Array && start.cents.length === 60); assert.equal(start.target, 100000); assert.equal(start.strategy, 'fewest');
  assert.deepEqual(Object.keys(start).sort(), ['budget', 'cents', 'id', 'strategy', 'target', 'timeoutMs', 'type'], 'no receipt objects, store names or ids leave the page');
  worker.onmessage({ data: { type: 'progress', id: start.id, fraction: 0.25 } });
  worker.onmessage({ data: { type: 'progress', id: start.id + 99, fraction: 0.9 } }); // another run's message
  worker.onmessage({ data: { type: 'done', id: start.id, outcome: { status: 'exact', path: 'dp', result: { total: 1, items: [0] } } } });
  worker.onmessage({ data: { type: 'done', id: start.id, outcome: { status: 'exact', path: 'dp', result: null } } }); // a second answer is ignored
  assert.deepEqual(await job.promise, { status: 'exact', path: 'dp', result: { total: 1, items: [0] } });
  assert.deepEqual(progress, [0.25]); assert.equal(worker.terminated, 1); assert.ok(h.timers.every(timer => timer.cleared), 'the watchdog was cleared');
});

test('a Worker error, an unreadable message or a thrown start become an error outcome and terminate the Worker', async () => {
  for (const fail of [w => w.onerror({ preventDefault() {} }), w => w.onmessageerror(), w => w.onmessage({ data: { type: 'error', id: 1, message: 'boom' } })]) {
    const h = harness(); const job = run(h, amounts(60)); fail(h.workers[0]);
    const outcome = await job.promise; assert.equal(outcome.status, 'error'); assert.equal(h.workers[0].terminated, 1);
  }
  const h = harness({ createWorker: () => ({ postMessage() { throw new Error('clone failed'); }, terminate() {} }) });
  assert.equal((await run(h, amounts(60)).promise).status, 'error');
});

test('the watchdog stops a Worker that never answers, and cancel stops it at once', async () => {
  let h = harness(); let job = run(h, amounts(60));
  const watchdog = h.timers.find(timer => timer.delay === 1500); assert.ok(watchdog, 'timeout plus grace');
  watchdog.callback(); assert.deepEqual(await job.promise, { status: 'timeout' }); assert.equal(h.workers[0].terminated, 1);
  h = harness(); job = run(h, amounts(60)); job.cancel(); job.cancel();
  assert.deepEqual(await job.promise, { status: 'cancelled' }); assert.equal(h.workers[0].terminated, 1, 'terminated exactly once');
  h.workers[0].onmessage({ data: { type: 'done', id: 3, outcome: { status: 'exact' } } }); // late: ignored
});

test('without a usable Worker a small pool runs on the page thread after a tick, a large one is reported unavailable, and cancel prevents the work', async () => {
  const noWorker = { createWorker: () => null };
  let h = harness(noWorker); let job = run(h, amounts(40), 40000);
  assert.equal(h.timers.length, 1); h.timers[0].callback();
  const outcome = await job.promise; assert.equal(outcome.status, 'exact'); assert.equal(outcome.path, 'dp');
  assert.deepEqual(outcome.result, solvePoolOptimization(amounts(40).map(cents => ({ cents })), 40000, 'closest').result);
  h = harness({ createWorker: () => { throw new Error('CSP'); } });
  const big = await run(h, Array.from({ length: 200 }, (_, i) => 100000 + i * 11), 2_000_000).promise;
  assert.equal(big.status, 'unavailable'); assert.ok(big.plan.cells > mainThreadFallbackCells);
  h = harness(noWorker); job = run(h, amounts(40), 40000); job.cancel(); h.timers[0].callback();
  assert.deepEqual(await job.promise, { status: 'cancelled' });
});

// ---- the Worker module itself ----------------------------------------------------------------------------------------------------------------------
test('the Worker module answers a start message with the solver outcome, throttles progress, and reports errors', async () => {
  const posted = []; globalThis.self = { postMessage: message => posted.push(message) };
  await import('../services/poolOptimizationWorker.js?worker-test');
  const cents = Float64Array.from(amounts(60));
  globalThis.self.onmessage({ data: { type: 'ignored' } }); globalThis.self.onmessage({});
  assert.equal(posted.length, 0, 'other messages are ignored');
  globalThis.self.onmessage({ data: { type: 'start', id: 7, cents, target: 100000, strategy: 'closest', budget: poolBudget, timeoutMs: 10000 } });
  const done = posted.find(message => message.type === 'done');
  assert.equal(done.id, 7); assert.deepEqual(done.outcome, solvePoolOptimization(Array.from(cents, value => ({ cents: value })), 100000, 'closest'));
  assert.ok(posted.filter(message => message.type === 'progress').length <= 3, 'progress is throttled to every 100 ms');
  posted.length = 0;
  globalThis.self.onmessage({ data: { type: 'start', id: 8, cents: Float64Array.from([-1, ...amounts(40)]), target: 1000, strategy: 'closest' } });
  assert.deepEqual(posted.map(message => [message.type, message.id]), [['error', 8]]); assert.match(posted[0].message, /safe nonnegative integer centavos/);
  delete globalThis.self;
});

test('the Worker URL is resolved next to the page module, so it works under the GitHub Pages /FSresibo/ sub-path', async () => {
  const client = await read('../ui/poolOptimizerClient.js');
  assert.match(client, /new Worker\(new URL\('\.\.\/services\/poolOptimizationWorker\.js', import\.meta\.url\), \{ type: 'module' \}\)/);
  assert.equal(new URL('../services/poolOptimizationWorker.js', 'https://owner.github.io/FSresibo/ui/poolOptimizerClient.js').href, 'https://owner.github.io/FSresibo/services/poolOptimizationWorker.js');
  const worker = await read('../services/poolOptimizationWorker.js');
  assert.match(worker, /from '\.\/poolOptimizationService\.js'/); assert.doesNotMatch(worker, /from '\//, 'no root-absolute imports that would break under a sub-path');
  for (const source of [client, await read('../services/poolOptimizationService.js')]) assert.doesNotMatch(source, /from '\/|https?:\/\//);
});

// ---- markup and wiring ------------------------------------------------------------------------------------------------------------------------------
test('the progress block is accessible markup that starts hidden, with a keyboard-reachable Cancel button, wired in app.js and styled with tokens', async () => {
  const html = await read('../index.html'), app = await read('../app.js'), css = await read('../styles.css');
  const block = html.match(/<div id="calculationProgress"[\s\S]*?<\/div>/)[0];
  assert.match(block, /class="calculation-progress" hidden/); assert.match(block, /<p id="calculationProgressText"[^>]*role="status" aria-live="polite"/);
  assert.match(block, /<progress id="calculationProgressBar" max="100" value="0" aria-label="Calculation progress">/); assert.match(block, /<button class="secondary" id="cancelCalculation" type="button">Cancel calculation<\/button>/);
  for (const name of ['calculationProgress', 'calculationProgressText', 'calculationProgressBar', 'cancelCalculation']) { assert.equal((html.match(new RegExp(`id="${name}"`, 'g')) ?? []).length, 1, name); assert.match(app, new RegExp(`${name}: document\\.querySelector\\('#${name}'\\)`)); }
  const rules = css.match(/\.calculation-progress[^{]*\{[^}]*\}/g).join('\n');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'colours come from tokens only');
  assert.match(css, /\.calculation-progress\[hidden\] \{ display: none; \}/);
});
