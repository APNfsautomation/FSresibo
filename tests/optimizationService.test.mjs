import assert from 'node:assert/strict';
import test from 'node:test';
import { MAXIMUM_EXCESS_CENTS, maximumOptimizationExcessCents, fewestReceiptsToleranceCents, findBest, findBestMatches, optimizationStrategies, toCents } from '../services/optimizationService.js';

const receipts = (...amounts) => amounts.map((cents, index) => ({ index, label: `Receipt ${index + 1}`, cents }));
const strategies = Object.values(optimizationStrategies);

// Independent small-input oracle: enumerate full subsets, build index arrays,
// classify, derive M from all under-target subsets, then sort each class.
function oracle(amounts, target, strategy, limit = 3) {
  const all = [];
  for (let mask = 1; mask < 2 ** amounts.length; mask++) {
    const items = [];
    let total = 0;
    for (let index = 0; index < amounts.length; index++) {
      if (mask & (2 ** index)) { total += amounts[index]; items.push(index); }
    }
    if (total > 0) all.push({ total, items });
  }
  const identity = (a, b) => {
    for (let index = 0; index < Math.min(a.items.length, b.items.length); index++) {
      if (a.items[index] !== b.items[index]) return a.items[index] - b.items[index];
    }
    return a.items.length - b.items.length;
  };
  const underOrder = (a, b) => b.total - a.total || a.items.length - b.items.length || identity(a, b);
  if (strategy === 'without-exceeding') return all.filter(a => a.total <= target).sort(underOrder).slice(0, limit);
  const preferred = all.filter(a => a.total >= target && a.total <= target + 5000);
  const under = all.filter(a => a.total < target);
  if (strategy === 'fewest') {
    const maximumUnder = under.reduce((m, a) => Math.max(m, a.total), 0);
    preferred.sort((a, b) => a.items.length - b.items.length || a.total - b.total || identity(a, b));
    const fallback = under.filter(a => a.total >= Math.max(1, maximumUnder - 5000));
    fallback.sort((a, b) => a.items.length - b.items.length || b.total - a.total || identity(a, b));
    return preferred.concat(fallback).slice(0, limit);
  }
  preferred.sort((a, b) => a.total - b.total || a.items.length - b.items.length || identity(a, b));
  return preferred.concat(under.sort(underOrder)).slice(0, limit);
}

test('fixed PHP 50 constants and compatibility helper are target independent', () => {
  assert.equal(MAXIMUM_EXCESS_CENTS, 5000);
  assert.equal(maximumOptimizationExcessCents, 5000);
  for (const target of [101, 10000, 1500000]) assert.equal(fewestReceiptsToleranceCents(target), 5000);
});

test('exact target, one-cent excess and inclusive PHP 50 maximum are eligible', () => {
  for (const strategy of [optimizationStrategies.closest, optimizationStrategies.fewest]) {
    for (const amount of [100000, 100001, 105000]) {
      assert.deepEqual(findBest(receipts(amount), 100000, strategy), { total: amount, items: [0] });
    }
    assert.equal(findBest(receipts(105001), 100000, strategy), null);
  }
});

test('qualifying target-reaching result beats a closer under-target result', () => {
  for (const strategy of [optimizationStrategies.closest, optimizationStrategies.fewest]) {
    assert.deepEqual(findBest(receipts(99000, 104000), 100000, strategy), { total: 104000, items: [1] });
  }
});

test('Closest orders preferred totals before highest under-target totals', () => {
  assert.deepEqual(findBestMatches(receipts(99000, 103000, 101000), 100000), [
    { total: 101000, items: [2] }, { total: 103000, items: [1] }, { total: 99000, items: [0] }
  ]);
});

test('Fewest prioritizes receipt count throughout the preferred PHP 50 range', () => {
  assert.deepEqual(findBest(receipts(50000, 50000, 103500, 98000), 100000, 'fewest'), { total: 103500, items: [2] });
});

test('Fewest derives its fallback window from global closest-under M', () => {
  const amounts = [50000, 48000, 93000, 92999];
  assert.deepEqual(findBestMatches(receipts(...amounts), 100000, 'fewest'), [
    { total: 93000, items: [2] }, { total: 98000, items: [0, 1] }
  ]);
});

test('Fewest fixed window replaces the old percentage behavior at large targets', () => {
  assert.deepEqual(findBest(receipts(990000, 500000, 498000), 1000000, 'fewest'), { total: 998000, items: [1, 2] });
});

test('Fewest under-target alternatives use M even after preferred results', () => {
  const amounts = [104000, 50000, 48000, 93000, 92999];
  assert.deepEqual(findBestMatches(receipts(...amounts), 100000, 'fewest'), [
    { total: 104000, items: [0] }, { total: 93000, items: [3] }, { total: 98000, items: [1, 2] }
  ]);
});

test('Do Not Exceed remains strict and returns highest non-zero totals', () => {
  assert.deepEqual(findBestMatches(receipts(105000, 99000, 1000), 100000, 'without-exceeding'), [
    { total: 100000, items: [1, 2] }, { total: 99000, items: [1] }, { total: 1000, items: [2] }
  ]);
  assert.equal(findBest(receipts(100001), 100000, 'without-exceeding'), null);
});

test('Closest and strict fallback rank total then count then identity', () => {
  for (const strategy of ['closest', 'without-exceeding']) {
    assert.deepEqual(findBestMatches(receipts(4000, 6000, 10000, 10000), 200000, strategy), [
      { total: 30000, items: [0, 1, 2, 3] },
      { total: 26000, items: [1, 2, 3] },
      { total: 24000, items: [0, 2, 3] }
    ]);
    assert.deepEqual(findBest(receipts(50000, 50000, 100000), 100000, strategy), { total: 100000, items: [2] });
  }
});

test('one, two, three and no valid combinations return only real results', () => {
  assert.equal(findBestMatches(receipts(100000), 100000).length, 1);
  assert.equal(findBestMatches(receipts(100000, 104000), 100000).length, 2);
  assert.equal(findBestMatches(receipts(100000, 102000, 104000), 100000).length, 3);
  for (const strategy of strategies) {
    assert.deepEqual(findBestMatches([], 100000, strategy), []);
    assert.equal(findBest([], 100000, strategy), null);
    assert.deepEqual(findBestMatches(receipts(200000), 100000, strategy), []);
    assert.deepEqual(findBestMatches(receipts(0, 0), 100000, strategy), []);
  }
});

test('equal amounts retain overlapping physical identities in lexicographic order', () => {
  for (const strategy of strategies) {
    assert.deepEqual(findBestMatches(receipts(50000, 50000, 50000, 50000), 100000, strategy), [
      { total: 100000, items: [0, 1] }, { total: 100000, items: [0, 2] }, { total: 100000, items: [0, 3] }
    ]);
  }
});

test('centavo inputs retain exact totals and existing toCents behavior', () => {
  assert.equal(toCents('PHP 1,500.50'), 150050);
  for (const strategy of strategies) {
    assert.deepEqual(findBest(receipts(toCents('12.34'), toCents('7.66')), toCents('20.00'), strategy), { total: 2000, items: [0, 1] });
  }
});

test('single API agrees with top-three first result for every strategy', () => {
  const input = receipts(99000, 104000, 40000, 60000, 50000);
  for (const strategy of strategies) {
    const first = findBestMatches(input, 100000, strategy, 1)[0] ?? null;
    assert.deepEqual(findBest(input, 100000, strategy), first);
    assert.deepEqual(findBestMatches(input, 100000, strategy)[0] ?? null, first);
    for (let repeat = 0; repeat < 4; repeat++) assert.deepEqual(findBestMatches(input, 100000, strategy), findBestMatches(input, 100000, strategy));
  }
});

test('numeric safety rejects unsafe target, values, aggregate and invalid limit', () => {
  for (const target of [0, -1, 1.5, NaN, Infinity, '10000', Number.MAX_SAFE_INTEGER - 4999]) {
    assert.throws(() => findBestMatches(receipts(1), target), /Target/);
  }
  for (const amount of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '10000', undefined]) {
    assert.throws(() => findBestMatches(receipts(amount), 10000), /Receipt amounts/);
  }
  assert.throws(() => findBestMatches(receipts(Number.MAX_SAFE_INTEGER, 1), 10000), /Aggregate/);
  assert.throws(() => findBestMatches(null, 10000), /array/);
  for (const limit of [0, 4, 1.5, NaN]) assert.throws(() => findBestMatches(receipts(1), 10000, 'closest', limit), /one and three/);
  for (const strategy of strategies) assert.throws(() => findBest(receipts(1), Number.MAX_SAFE_INTEGER, strategy), /Target/);
});

test('safe integer boundary permits exact full and intermediate subset sums', () => {
  const target = Number.MAX_SAFE_INTEGER - 5000;
  assert.deepEqual(findBestMatches(receipts(target, 5000), target), [
    { total: target, items: [0] }, { total: Number.MAX_SAFE_INTEGER, items: [0, 1] }, { total: 5000, items: [1] }
  ]);
  assert.deepEqual(findBest(receipts(0, 10000), 10000), { total: 10000, items: [1] });
});

test('unknown strategies keep the existing Closest Match fallback', () => {
  const input = receipts(99000, 104000);
  assert.deepEqual(findBestMatches(input, 100000, 'unknown'), findBestMatches(input, 100000));
});

test('32 inputs include the highest identity bit and reject input 33', () => {
  const amounts = Array(31).fill(20000).concat(10000);
  for (const strategy of strategies) assert.deepEqual(findBest(receipts(...amounts), 10000, strategy), { total: 10000, items: [31] });
  assert.throws(() => findBestMatches(receipts(...Array(33).fill(1)), 10000), /32 receipts/);
  assert.deepEqual(findBestMatches(receipts(...Array(32).fill(50000)), 100000), [
    { total: 100000, items: [0, 1] }, { total: 100000, items: [0, 2] }, { total: 100000, items: [0, 3] }
  ]);
  for (const strategy of strategies) {
    assert.deepEqual(findBestMatches(receipts(...Array(29).fill(200000), 50000, 50000, 50000), 100000, strategy), [
      { total: 100000, items: [29, 30] }, { total: 100000, items: [29, 31] }, { total: 100000, items: [30, 31] }
    ]);
  }
});

test('boundary and tie-heavy fixtures match independent exhaustive oracle', () => {
  const fixtures = [
    [100000, 100001, 105000, 105001, 99000],
    [0, 0, 50000, 50000, 50000],
    [104000, 50000, 48000, 93000, 92999],
    [1, 2, 3, 4, 5, 6, 7],
    [9999, 10000, 10001, 4999, 5000, 5001],
    [40000, 60000, 40000, 60000, 100000, 100000]
  ];
  for (const amounts of fixtures) for (const target of [1, 10000, 100000, 1000000]) for (const strategy of strategies) {
    assert.deepEqual(findBestMatches(receipts(...amounts), target, strategy), oracle(amounts, target, strategy), JSON.stringify({ amounts, target, strategy }));
  }
});

test('seeded randomized inputs match independent oracle in exact count and order', () => {
  let state = 0x36c0ffee;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  const boundary = [1, 99, 5000, 5001, 95000, 99999, 100000, 100001, 105000, 105001];
  for (let caseIndex = 0; caseIndex < 240; caseIndex++) {
    const size = 1 + next() % 10;
    const amounts = Array.from({ length: size }, () => caseIndex % 3 === 0 ? (1 + next() % 5) * 5000 : caseIndex % 3 === 1 ? boundary[next() % boundary.length] : 1 + next() % 150000);
    const target = caseIndex % 4 === 0 ? 100000 : 1 + next() % 400000;
    for (const strategy of strategies) for (const limit of [1, 2, 3]) {
      assert.deepEqual(findBestMatches(receipts(...amounts), target, strategy, limit), oracle(amounts, target, strategy, limit), JSON.stringify({ seed: '0x36c0ffee', caseIndex, amounts, target, strategy, limit }));
    }
  }
});
