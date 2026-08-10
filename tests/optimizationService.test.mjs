import assert from 'node:assert/strict';
import test from 'node:test';
import { fewestReceiptsToleranceCents, findBest, optimizationStrategies, toCents } from '../services/optimizationService.js';

const receipts = (...amounts) => amounts.map((cents, index) => ({ index, label: `Receipt ${index + 1}`, cents }));

test('Closest Match preserves the existing ranking rules', () => {
  const best = findBest(receipts(6000, 4000, 9900), 10000);
  assert.equal(best.total, 10000);
  assert.equal(best.items.length, 2);
});

test('Fewest Receipts rejects a poor one-receipt result outside the 2% gate', () => {
  const best = findBest(receipts(6000, 5500, 4500), 10000, optimizationStrategies.fewest);
  assert.equal(best.total, 10000);
  assert.equal(best.items.length, 2);
});

test('Fewest Receipts selects a lower-count result inside the 2% gate', () => {
  const best = findBest(receipts(9900, 6000, 4000), 10000, optimizationStrategies.fewest);
  assert.equal(best.total, 9900);
  assert.equal(best.items.length, 1);
});

test('Fewest Receipts tie-breaking prefers the larger total after count and gap', () => {
  const best = findBest(receipts(9800, 10200, 6000, 4000), 10000, optimizationStrategies.fewest);
  assert.equal(best.total, 10200);
  assert.equal(best.items.length, 1);
});

test('Do Not Exceed Target never returns an over-target total', () => {
  const best = findBest(receipts(10500, 9900, 200), 10000, optimizationStrategies.withoutExceeding);
  assert.equal(best.total, 9900);
  assert.ok(best.total <= 10000);
});

test('Do Not Exceed Target returns no result when no non-zero combination qualifies', () => {
  assert.equal(findBest(receipts(2000), 1000, optimizationStrategies.withoutExceeding), null);
});

test('exact matches work for every strategy', () => {
  for (const strategy of Object.values(optimizationStrategies)) {
    const best = findBest(receipts(1250, 8750), 10000, strategy);
    assert.equal(best.total, 10000);
  }
});

test('empty pools, single receipts, duplicates, and centavo decimals remain supported', () => {
  assert.equal(findBest([], 10000), null);
  assert.equal(findBest(receipts(1234), 2000).total, 1234);
  assert.equal(findBest(receipts(toCents('12.34'), toCents('7.66')), toCents('20.00')).total, 2000);
});

test('duplicate amounts and multiple equally valid combinations produce a stable valid result', () => {
  const best = findBest(receipts(5000, 5000, 5000, 5000), 10000);
  assert.equal(best.total, 10000);
  assert.equal(best.items.length, 2);
  assert.deepEqual(best.items, [2, 3]);
});

test('the fixed 2% gate is calculated in centavos', () => {
  assert.equal(fewestReceiptsToleranceCents(1500000), 30000);
  assert.equal(fewestReceiptsToleranceCents(101), 2);
});
