// Run separately from the regression suite: node --expose-gc tests/optimizationService.benchmark.mjs
import assert from 'node:assert/strict';
import { cpus, platform, release } from 'node:os';
import { findBest, findBestMatches, optimizationStrategies } from '../services/optimizationService.js';

const scenarios = [
  { name: 'unique', amounts: Array.from({ length: 32 }, (_, i) => 101 + i * 137), target: 50000 },
  { name: 'identical', amounts: Array(32).fill(5000), target: 50000 },
  { name: 'duplicate-heavy', amounts: Array.from({ length: 32 }, (_, i) => [1201, 2302, 3403, 4504][i % 4]), target: 40000 },
  { name: 'many-exact-matches', amounts: Array.from({ length: 32 }, (_, i) => (1 + i % 8) * 1000), target: 20000 },
  { name: 'small-target-no-result', amounts: Array.from({ length: 32 }, (_, i) => 10000 + i), target: 1 },
  { name: 'large-target', amounts: Array.from({ length: 32 }, (_, i) => 100000000000 + i * 101), target: 1700000020000 },
  { name: 'no-preferred-range', amounts: Array.from({ length: 32 }, (_, i) => 101 + i * 137), target: 1000000 },
  { name: 'fewest-high-count', amounts: Array(32).fill(10000), target: 320000 }
];

console.log(JSON.stringify({ node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, runs: 5, gcAvailable: Boolean(globalThis.gc), timing: 'Node/V8 engine only; mobile/browser acceptance remains pending' }));
let worstMedian = 0, worstRun = 0;
for (const { name, amounts, target } of scenarios) {
  const receipts = amounts.map(cents => ({ cents }));
  for (const strategy of Object.values(optimizationStrategies)) {
    for (const api of ['findBest', 'findBestMatches']) {
      const calculate = () => api === 'findBest' ? findBest(receipts, target, strategy) : findBestMatches(receipts, target, strategy, 3);
      const expected = calculate();
      const times = [], heapDeltas = [], retainedDeltas = [];
      for (let run = 0; run < 5; run++) {
        globalThis.gc?.();
        const before = process.memoryUsage().heapUsed;
        const start = performance.now();
        const result = calculate();
        times.push(performance.now() - start);
        heapDeltas.push((process.memoryUsage().heapUsed - before) / 1048576);
        assert.deepEqual(result, expected, 'Repeated calculations must preserve exact identities and order.');
        globalThis.gc?.();
        retainedDeltas.push((process.memoryUsage().heapUsed - before) / 1048576);
      }
      times.sort((a, b) => a - b);
      worstMedian = Math.max(worstMedian, times[2]);
      worstRun = Math.max(worstRun, times[4]);
      console.log(JSON.stringify({ scenario: name, strategy, api, medianMs: +times[2].toFixed(2), maxMs: +times[4].toFixed(2), maxHeapDeltaMiB: +Math.max(...heapDeltas).toFixed(2), maxRetainedDeltaMiB: +Math.max(...retainedDeltas).toFixed(2), resultCount: api === 'findBest' ? Number(Boolean(expected)) : expected.length }));
    }
  }
}
console.log(JSON.stringify({ worstMedianMs: +worstMedian.toFixed(2), worstRunMs: +worstRun.toFixed(2), desktopTimingTargetsMet: worstMedian < 250 && worstRun <= 500, memory: 'Heap deltas are approximate post-call observations, not peak heap measurements.' }));
