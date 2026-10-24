// Run separately from the regression suite: node --expose-gc tests/benchmarks/poolOptimization.benchmark.mjs [--full]
// Measures the exact large-pool solver (Issue #29) on representative pools. The default grid finishes in about a minute; --full adds the PHP 100,000 targets
// (about 10 s and 0.5 GB each at 400 receipts). Memory is sampled as the peak of process.memoryUsage().arrayBuffers during the run (typed arrays dominate)
// and as the process peak resident set (cumulative for the process, so it never goes down between rows).
import assert from 'node:assert/strict';
import { cpus, platform, release, totalmem } from 'node:os';
import { planPoolOptimization, poolBudget, solvePoolOptimization } from '../../services/poolOptimizationService.js';

const full = process.argv.includes('--full');
let seed = 4242; const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const logUniform = (low, high) => Math.round(Math.exp(Math.log(low) + random() * (Math.log(high) - Math.log(low))));
const distributions = {
  typical: () => logUniform(5000, 300000),            // PHP 50 - 3,000 with arbitrary centavos
  pesos: () => Math.round(logUniform(2000, 200000) / 100) * 100,
  duplicate: (() => { const values = Array.from({ length: 8 }, () => logUniform(8000, 150000)); return () => values[Math.floor(random() * values.length)]; })(),
  large: () => logUniform(50000, 2000000)             // PHP 500 - 20,000
};
const sizes = [33, 40, 64, 100, 200, 400];
const targets = full ? [500000, 2000000, 10000000] : [500000, 2000000];
const strategies = ['closest', 'fewest', 'without-exceeding'];
const mib = bytes => +(bytes / 1048576).toFixed(1);

console.log(JSON.stringify({ node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryGiB: +(totalmem() / 2 ** 30).toFixed(1), gcAvailable: Boolean(globalThis.gc), budget: poolBudget, grid: full ? 'full' : 'default', runs: 1 }));
const rows = [];
function measure(label, amounts, target, strategy, expectStatus = 'exact') {
  const receipts = amounts.map(cents => ({ cents }));
  const plan = planPoolOptimization(receipts, target, strategy);
  globalThis.gc?.();
  let peakBuffers = process.memoryUsage().arrayBuffers; const baseBuffers = peakBuffers;
  const started = performance.now();
  const outcome = solvePoolOptimization(receipts, target, strategy, { onProgress: () => { peakBuffers = Math.max(peakBuffers, process.memoryUsage().arrayBuffers); } });
  const ms = performance.now() - started;
  assert.equal(outcome.status, expectStatus, `${label}: ${outcome.status}`);
  if (outcome.status === 'exact' && outcome.result) {
    assert.equal(outcome.result.total, outcome.result.items.reduce((sum, index) => sum + amounts[index], 0), `${label}: the total is the sum of the chosen receipts`);
    if (strategy !== 'without-exceeding' && plan.path === 'dp') assert.ok(outcome.result.total >= target && outcome.result.total <= target + 5000, `${label}: inside the PHP 50 range`);
  }
  const row = { label, strategy, path: outcome.path ?? outcome.status, ms: Math.round(ms), predictedCellsM: Math.round(plan.cells / 1e6), predictedMiB: mib(plan.bytes), measuredPeakBuffersMiB: mib(peakBuffers - baseBuffers), processPeakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) };
  rows.push(row); console.log(JSON.stringify(row));
}
for (const [name, generate] of Object.entries(distributions)) for (const size of sizes) {
  const amounts = Array.from({ length: size }, generate), total = amounts.reduce((a, b) => a + b, 0);
  for (const target of targets) {
    if (target > total * 0.5) continue; // keep every row a genuine search (the target is above the pool otherwise: see the fast-path rows below)
    for (const strategy of strategies) {
      const plan = planPoolOptimization(amounts.map(cents => ({ cents })), target, strategy);
      if (!plan.withinBudget) { console.log(JSON.stringify({ label: `${name} n=${size} target=${target / 100}`, strategy, skipped: `over budget (${plan.reason}): ${Math.round(plan.cells / 1e6)}M cells, ${mib(plan.bytes)} MiB` })); continue; }
      measure(`${name} n=${size} target=${target / 100}`, amounts, target, strategy);
    }
  }
}
// High-target fast paths: a target above the pool needs no search at all.
for (const size of [64, 400]) {
  const amounts = Array.from({ length: size }, distributions.typical), total = amounts.reduce((a, b) => a + b, 0);
  for (const strategy of strategies) measure(`typical n=${size} target above pool`, amounts, total + 123456, strategy);
}
// Over budget: refused before any allocation.
{ const amounts = Array.from({ length: 400 }, distributions.large), total = amounts.reduce((a, b) => a + b, 0);
  const before = process.memoryUsage().arrayBuffers; const started = performance.now();
  const outcome = solvePoolOptimization(amounts.map(cents => ({ cents })), Math.floor(total / 2), 'closest');
  console.log(JSON.stringify({ label: 'large n=400 target half the pool', outcome: outcome.status, reason: outcome.plan?.reason, ms: +(performance.now() - started).toFixed(2), allocatedMiB: mib(process.memoryUsage().arrayBuffers - before) })); }
const slowest = rows.reduce((worst, row) => row.ms > worst.ms ? row : worst, rows[0]);
console.log(JSON.stringify({ summary: { rows: rows.length, slowest: `${slowest.label} ${slowest.strategy}`, slowestMs: slowest.ms, largestPredictedMiB: Math.max(...rows.map(row => row.predictedMiB)) } }));
