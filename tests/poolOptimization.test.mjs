// Issue #29: exact large-pool Receipt Optimization solver (services/poolOptimizationService.js).
// Correctness is proved against the unchanged 32-receipt engine (for pools of up to 32) and against an independent forward-DP oracle (for 33 and more).
import assert from 'node:assert/strict';
import test from 'node:test';
import { findBest, optimizationStrategies } from '../services/optimizationService.js';
import { ENGINE_RECEIPT_LIMIT, planPoolOptimization, poolBudget, solvePoolOptimization } from '../services/poolOptimizationService.js';
import { buildOracle, oracleBest } from './helpers/poolOracle.mjs';

const strategies = Object.values(optimizationStrategies);
const pool = amounts => amounts.map(cents => ({ cents }));
const solve = (amounts, target, strategy, options) => solvePoolOptimization(pool(amounts), target, strategy, options);
const exact = (amounts, target, strategy) => { const outcome = solve(amounts, target, strategy); assert.equal(outcome.status, 'exact'); return outcome.result; };
let seed = 20291024;
const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const between = (low, high) => low + Math.floor(random() * (high - low + 1));

// ---- the oracle itself, checked against the existing engine --------------------------------------------------------------------------------------
test('the independent oracle agrees with the existing engine on pools of up to 14 receipts (so it can be trusted beyond 32)', () => {
  for (let round = 0; round < 800; round++) {
    const amounts = Array.from({ length: between(1, 14) }, () => between(0, 3) ? between(1, 9000) : 0);
    const sum = amounts.reduce((a, b) => a + b, 0), oracle = buildOracle(amounts);
    for (const target of [between(1, sum + 3), Math.max(1, sum), between(1, 60)]) for (const strategy of strategies) {
      assert.deepEqual(oracleBest(oracle, target, strategy), findBest(pool(amounts), target, strategy), `${strategy} ${target} ${amounts}`);
    }
  }
});

// ---- 1 to 32 receipts: unchanged behavior --------------------------------------------------------------------------------------------------------
test('pools of up to 32 receipts are delegated to the existing engine and return exactly what it returns', () => {
  assert.equal(ENGINE_RECEIPT_LIMIT, 32);
  for (let round = 0; round < 60; round++) {
    const amounts = Array.from({ length: between(1, 32) }, () => between(0, 5) ? between(1, 60000) : 0);
    const sum = amounts.reduce((a, b) => a + b, 0);
    for (const target of [between(1, sum + 9000), 5000 * between(1, 12)]) for (const strategy of strategies) {
      const outcome = solve(amounts, target, strategy);
      assert.equal(outcome.path, 'engine'); assert.equal(outcome.status, 'exact');
      assert.deepEqual(outcome.result, findBest(pool(amounts), target, strategy));
    }
  }
  assert.equal(planPoolOptimization(pool(Array(32).fill(100)), 500, 'closest').path, 'engine');
  assert.equal(planPoolOptimization(pool(Array(33).fill(100)), 500, 'closest').path, 'dp');
});

test('the engine itself is untouched: it still refuses 33 receipts', () => {
  assert.throws(() => findBest(pool(Array(33).fill(100)), 500, 'closest'), /up to 32 receipts/);
});

// ---- the 33rd receipt (and later) can be the only correct answer --------------------------------------------------------------------------------
test('receipt #33 (index 32) is chosen when it is the only correct answer, for every strategy', () => {
  const amounts = [...Array(32).fill(10000), 5555];
  for (const strategy of strategies) assert.deepEqual(exact(amounts, 5555, strategy), { total: 5555, items: [32] }, strategy);
  const later = [...Array(60).fill(10000), 4321, 777]; // indexes 60 and 61
  assert.deepEqual(exact(later, 4321 + 777, 'closest'), { total: 5098, items: [60, 61] });
  assert.deepEqual(exact(later, 5098, 'without-exceeding'), { total: 5098, items: [60, 61] });
  assert.deepEqual(exact(later, 5098, 'fewest'), { total: 10000, items: [0] }, 'one PHP 100.00 receipt is inside [T, T + PHP 50] and is fewer than the two-receipt exact match');
});

// ---- differential: pools of 33 to 70 against the independent oracle -----------------------------------------------------------------------------
const generators = [
  n => Array.from({ length: n }, () => between(1, 400)),
  n => Array.from({ length: n }, () => between(1, 16) * 25),
  n => Array.from({ length: n }, () => [101, 233, 340, 500, 5000][between(0, 4)]),
  n => Array.from({ length: n }, () => between(0, 4) ? between(1, 150) : 0),
  n => Array.from({ length: n }, () => between(1, 6) * 1000 + between(0, 1)),
  n => Array.from({ length: n }, () => between(1, 3000))
];
test('33 to 70 receipts agree with the independent oracle for all three strategies, with targets at, above and below the pool total', () => {
  let cases = 0, usedHighIndex = 0; const paths = new Set();
  for (let round = 0; round < 30; round++) {
    const amounts = generators[round % generators.length](between(33, 70));
    const sum = amounts.reduce((a, b) => a + b, 0), oracle = buildOracle(amounts), subset = amounts.filter(() => random() < 0.5).reduce((a, b) => a + b, 0);
    const targets = [between(1, sum), Math.max(1, sum - between(0, 3)), sum, sum + between(1, 9000), between(1, 80), 5000 * between(1, 5), ...(subset > 0 ? [subset, subset + 1, Math.max(1, subset - 5000), subset + 5000, subset + 5001] : [])];
    for (const target of targets) for (const strategy of strategies) {
      const outcome = solve(amounts, target, strategy); const expected = oracleBest(oracle, target, strategy);
      assert.equal(outcome.status, 'exact', `${strategy} ${target}`); paths.add(outcome.path); cases++;
      assert.deepEqual(outcome.result, expected, `${strategy} target ${target}\n${amounts}`);
      if (expected?.items.some(index => index >= 32)) usedHighIndex++;
    }
  }
  assert.ok(cases > 500 && usedHighIndex > 100, `cases ${cases}, results using receipt #33 or later ${usedHighIndex}`);
  for (const path of ['all-positive', 'complement', 'dp']) assert.ok(paths.has(path), `the ${path} path was exercised`);
  assert.ok([...paths].every(path => ['all-positive', 'complement', 'dp', 'none'].includes(path)), 'and nothing else');
});

test('a pool of up to 32 receipts padded with unusable receipts (zero or above the cap) at random positions equals the existing engine on the core pool', () => {
  for (let round = 0; round < 120; round++) {
    const core = Array.from({ length: between(8, 32) }, () => between(1, 20000)), sum = core.reduce((a, b) => a + b, 0);
    const target = between(0, 3) ? between(1, sum + 3000) : sum + between(1, 9000); // often above the pool: all-positive and complement fast paths
    const padded = [...core], origin = core.map((_, index) => index);
    for (let k = between(1, 40); k > 0; k--) { const position = between(0, padded.length); padded.splice(position, 0, between(0, 1) ? 0 : target + 5001 + between(0, 999)); origin.splice(position, 0, -1); }
    for (const strategy of strategies) {
      const expected = findBest(pool(core), target, strategy), actual = solve(padded, target, strategy).result;
      assert.deepEqual(actual && { total: actual.total, items: actual.items.map(index => origin[index]) }, expected, `${strategy} ${target}`);
    }
  }
});

// ---- accounting boundary: PHP 50.00 accepted, PHP 50.01 excluded --------------------------------------------------------------------------------
test('PHP 50.00 of excess is accepted and PHP 50.01 is excluded in a pool of 40 receipts (the cap also prunes the big receipts)', () => {
  const big = Array(38).fill(9_000_000);
  assert.deepEqual(exact([97223, 7777, ...big], 100000, 'closest'), { total: 105000, items: [0, 1] }, 'T + 50.00 is eligible');
  assert.deepEqual(exact([97223, 7778, ...big], 100000, 'closest'), { total: 97223, items: [0] }, 'T + 50.01 is not: the best total below the target wins');
  assert.deepEqual(exact([97223, 7777, ...big], 100000, 'without-exceeding'), { total: 97223, items: [0] }, 'Do Not Exceed never goes above the target');
  assert.deepEqual(exact([97223, 7777, ...big], 100000, 'fewest'), { total: 105000, items: [0, 1] });
});

test('Fewest prefers fewer receipts across the whole PHP 50 range, then the lower total, then the lowest identity', () => {
  const filler = Array(34).fill(1_000_000);
  const amounts = [10000, 5000, 5001, 5002, 3000, 2000, ...filler]; // target 10000: [0] exact (1 receipt) beats [1,2] (2 receipts, 10001)
  assert.deepEqual(exact(amounts, 10000, 'fewest'), { total: 10000, items: [0] });
  assert.deepEqual(exact([10001, 4000, 6000, ...filler], 10000, 'fewest'), { total: 10001, items: [0] }, 'one receipt at T + 0.01 beats two receipts at exactly T');
  assert.deepEqual(exact([4000, 6000, 3000, 7000, ...filler], 10000, 'fewest'), { total: 10000, items: [0, 1] }, 'equal counts and totals: the set with the smaller first index wins');
});

// ---- Fewest when the whole pool is below the target: the omitted-receipt (complement) problem -------------------------------------------------
test('Fewest below the pool total keeps all but at most PHP 50 of receipts, preferring most omitted, then the smaller omitted amount, then the lowest kept identity', () => {
  const amounts = Array(40).fill(1000).map((cents, index) => index < 5 ? 3000 : cents);
  const plan = planPoolOptimization(pool(amounts), 10_000_000, 'fewest');
  assert.equal(plan.path, 'complement'); assert.ok(plan.cells < 5000 * 41, 'the complement table is at most PHP 50 wide');
  const sum = amounts.reduce((a, b) => a + b, 0);
  const result = exact(amounts, sum + 1, 'fewest');
  assert.equal(result.total, sum - 5000, 'five 10.00 receipts omitted, the largest allowed omission by count, leaving 5 receipts fewer');
  assert.equal(result.items.length, 35);
  assert.deepEqual(result.items, amounts.map((_, index) => index).filter(index => ![35, 36, 37, 38, 39].includes(index)), 'ties omit the largest indexes so the smallest stay kept');
  const oracle = buildOracle(amounts);
  for (const target of [sum + 1, sum + 5000, sum + 9999]) assert.deepEqual(exact(amounts, target, 'fewest'), oracleBest(oracle, target, 'fewest'));
});

test('target above the pool: Closest and Do Not Exceed take every positive receipt immediately, and a pool equal to the target is an exact match', () => {
  const amounts = [0, 150, 0, ...Array(40).fill(275), 90];
  const positives = amounts.map((cents, index) => cents > 0 ? index : -1).filter(index => index >= 0), sum = amounts.reduce((a, b) => a + b, 0);
  for (const strategy of ['closest', 'without-exceeding']) {
    const outcome = solve(amounts, sum + 12345, strategy);
    assert.equal(outcome.path, 'all-positive'); assert.deepEqual(outcome.result, { total: sum, items: positives });
    assert.deepEqual(solve(amounts, sum, strategy), { status: 'exact', path: 'all-positive', result: { total: sum, items: positives } }, 'target equal to the pool is exact and needs no search');
  }
  assert.deepEqual(exact(amounts, sum, 'fewest'), { total: sum, items: positives });
  assert.deepEqual(solve(Array(40).fill(0), 100, 'closest'), { status: 'exact', path: 'none', result: null }, 'no positive receipt: no recommendation');
  assert.equal(solve([...Array(39).fill(0), 7], 5000, 'without-exceeding').result.total, 7);
});

test('duplicate amounts keep distinct identities and the lowest indexes win ties', () => {
  const amounts = [...Array(50).fill(100)]; // any 5 receipts make 500; the lowest identity is 0..4
  for (const strategy of strategies) assert.deepEqual(exact(amounts, 500, strategy), { total: 500, items: [0, 1, 2, 3, 4] }, strategy);
});

// ---- scale: representative pools at the sizes in Issue #29 -------------------------------------------------------------------------------------
test('representative pools of 40, 64, 100, 200 and 400 receipts return consistent exact results (sum, order, range) for every strategy', () => {
  for (const [size, target] of [[40, 400000], [64, 500000], [100, 800000], [200, 800000], [400, 500000]]) {
    const amounts = Array.from({ length: size }, () => Math.round(Math.exp(Math.log(5000) + random() * Math.log(60))));
    for (const strategy of strategies) {
      const outcome = solve(amounts, target, strategy); assert.equal(outcome.status, 'exact', `${size} ${strategy}`);
      const { total, items } = outcome.result;
      assert.equal(total, items.reduce((sum, index) => sum + amounts[index], 0), 'the reported total is the sum of the chosen receipts');
      assert.deepEqual(items, [...new Set(items)].sort((a, b) => a - b), 'ascending unique indexes');
      if (strategy === 'without-exceeding') assert.ok(total <= target); else assert.ok(total >= target && total <= target + 5000, `${size} ${strategy}: ${total}`);
    }
  }
});

// ---- validation, budgets and interruption --------------------------------------------------------------------------------------------------------
test('invalid input is rejected like the engine does, including values that would later be pruned', () => {
  const big = Array(40).fill(100);
  assert.throws(() => solvePoolOptimization('x', 100, 'closest'), TypeError);
  assert.throws(() => solve(big, 0, 'closest'), /safe positive integer centavos/);
  assert.throws(() => solve(big, Number.MAX_SAFE_INTEGER, 'closest'), /safe positive integer centavos/);
  assert.throws(() => solve([...big, -1], 500, 'closest'), /safe nonnegative integer centavos/);
  assert.throws(() => solve([...big, 1.5], 500, 'closest'), /safe nonnegative integer centavos/);
  assert.throws(() => solve([...big, Number.MAX_SAFE_INTEGER], 500, 'closest'), /Aggregate receipt amount exceeds safe integer centavos/, 'an above-cap receipt is still validated before it is pruned');
  assert.throws(() => solve([...big, NaN], 500, 'closest'), RangeError);
});

test('budget preflight refuses oversized pools before allocating anything large, with the reason', () => {
  const before = process.memoryUsage().arrayBuffers;
  const heavy = Array.from({ length: 400 }, (_, index) => 500_000 + index * 7); // PHP 5,000+ receipts, pool PHP 2 million, target PHP 1 million
  let outcome = solve(heavy, 100_000_000, 'closest');
  assert.equal(outcome.status, 'over-budget'); assert.ok(['work', 'range', 'memory'].includes(outcome.plan.reason), outcome.plan.reason);
  assert.ok(process.memoryUsage().arrayBuffers - before < 5 * 1024 * 1024, 'nothing proportional to the target was allocated');
  outcome = solve(Array.from({ length: 400 }, (_, i) => 100003 + i), 40_000_000, 'closest');
  assert.equal(outcome.status, 'over-budget'); assert.equal(outcome.plan.reason, 'work');
  const narrow = { ...poolBudget, maxCells: 1e5 };
  assert.equal(planPoolOptimization(pool(Array.from({ length: 100 }, (_, i) => 10001 + i)), 500000, 'closest', narrow).reason, 'work');
  assert.equal(planPoolOptimization(pool(Array.from({ length: 100 }, (_, i) => 10001 + i)), 500000, 'closest', { ...poolBudget, maxBytes: 1024 }).reason, 'memory');
  const range = planPoolOptimization(pool(Array.from({ length: 40 }, (_, i) => 200_000_003 + i)), 4_000_000_000, 'closest');
  assert.deepEqual([range.withinBudget, range.reason], [false, 'range'], 'a sum range beyond 2^30 units is refused before any bitset index could overflow');
  const plan = planPoolOptimization(pool(Array.from({ length: 400 }, (_, i) => 5000 + i * 11)), 2_000_000, 'closest');
  assert.ok(plan.withinBudget && plan.cells > 0 && plan.bytes > 0 && plan.cells <= poolBudget.maxCells);
});

test('the gcd scaling never moves a centavo boundary: whole-peso pools and a target that is not a whole peso', () => {
  const amounts = Array.from({ length: 45 }, (_, index) => (index % 9 + 1) * 100), oracle = buildOracle(amounts);
  for (const target of [701, 1250, 2299, 2300, 2301, 5101]) for (const strategy of strategies) assert.deepEqual(exact(amounts, target, strategy), oracleBest(oracle, target, strategy), `${strategy} ${target}`);
  assert.equal(planPoolOptimization(pool(amounts), 2300, 'closest').unit, 100);
});

test('cancellation and timeout stop the calculation without a recommendation, and progress is monotonic and never past 100%', () => {
  const amounts = Array.from({ length: 120 }, (_, index) => 3000 + index * 13);
  const fractions = []; const outcome = solve(amounts, 300000, 'closest', { onProgress: fraction => fractions.push(fraction) });
  assert.equal(outcome.status, 'exact'); assert.ok(fractions.length > 20);
  assert.ok(fractions.every((value, i) => value >= 0 && value <= 1 && (i === 0 || value >= fractions[i - 1])), 'monotonic within 0..1');
  let polls = 0; assert.deepEqual(solve(amounts, 300000, 'closest', { shouldCancel: () => ++polls > 30 }), { status: 'cancelled' });
  let clock = 0; assert.deepEqual(solve(amounts, 300000, 'closest', { timeoutMs: 100, now: () => (clock += 10) }), { status: 'timeout' });
  assert.deepEqual(solve(amounts, 300000, 'closest', { shouldCancel: () => true }), { status: 'cancelled' }, 'cancelled before any work');
});

test('an allocation failure becomes an over-budget status instead of a crash', () => {
  const original = globalThis.Uint32Array;
  globalThis.Uint32Array = function () { throw new RangeError('Array buffer allocation failed'); };
  try {
    const outcome = solve(Array.from({ length: 40 }, (_, index) => 100000 + index), 2_000_000, 'closest');
    assert.equal(outcome.status, 'over-budget'); assert.equal(outcome.plan.reason, 'allocation');
  } finally { globalThis.Uint32Array = original; }
});

// ---- Round 1 review of PR #30 -----------------------------------------------------------------------------------------------------------------------
test('R1: the Fewest complement path honours every budget (work, memory, range) and refuses before any work', () => {
  const amounts = Array(33).fill(100); // pool 3,300 centavos, target above the pool, Fewest: the omitted-receipt (complement) path
  const control = planPoolOptimization(pool(amounts), 4000, 'fewest');
  assert.equal(control.path, 'complement'); assert.ok(control.cells > 5 && control.withinBudget, 'within the default budget');
  for (const [limits, reason] of [[{ maxCells: 5 }, 'work'], [{ maxBytes: 1024 }, 'memory'], [{ maxRangeUnits: 1 }, 'range']]) {
    const budget = { ...poolBudget, ...limits };
    const plan = planPoolOptimization(pool(amounts), 4000, 'fewest', budget);
    assert.deepEqual([plan.path, plan.withinBudget, plan.reason], ['complement', false, reason], reason);
    let progressed = 0; const outcome = solvePoolOptimization(pool(amounts), 4000, 'fewest', { budget, onProgress: () => { progressed++; } });
    assert.equal(outcome.status, 'over-budget', reason); assert.equal(outcome.plan.reason, reason);
    assert.ok(progressed <= 1, 'no search step ran');
  }
  assert.equal(solve(amounts, 4000, 'fewest').status, 'exact', 'the default budget still computes it');
});

test('R3: when no positive receipt can take part the plan is an exact finite "none", for every strategy', () => {
  const amounts = Array(33).fill(10000); // every receipt is above target + PHP 50 (and above the target)
  for (const strategy of strategies) {
    const plan = planPoolOptimization(pool(amounts), 10, strategy);
    assert.deepEqual([plan.path, plan.cells, plan.bytes, plan.kept, plan.rangeUnits, plan.withinBudget], ['none', 0, 0, 0, 0, true], strategy);
    assert.ok([plan.cells, plan.bytes, plan.unit, plan.rangeUnits].every(Number.isFinite), 'no NaN in the cost preview');
    assert.deepEqual(solve(amounts, 10, strategy), { status: 'exact', path: 'none', result: null }, strategy);
    assert.equal(oracleBest(buildOracle(amounts), 10, strategy), null, 'the independent oracle also finds nothing');
  }
  const noExceed = planPoolOptimization(pool(Array(40).fill(5000)), 4999, 'without-exceeding'); // above the strict target only
  assert.deepEqual([noExceed.path, noExceed.cells, noExceed.withinBudget], ['none', 0, true]);
});
