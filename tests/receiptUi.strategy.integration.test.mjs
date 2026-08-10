import assert from 'node:assert/strict';
import test from 'node:test';
import { findBest, optimizationStrategies } from '../services/optimizationService.js';
import { createOptimizationStrategyState, optimizationStrategyDetails, optimizationStrategyRules } from '../ui/receiptUi.js';

const receiptCents = [50000, 53000, 100000, 20000, 20500, 20000, 20000, 20000];
const receipts = receiptCents.map((cents, index) => ({ index, label: `Receipt ${index + 1}`, cents }));
const targetCents = 201000;

const makeStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const makeState = (storage, getUserId) => {
  const select = { value: optimizationStrategies.closest };
  const helper = { textContent: '' };
  const state = createOptimizationStrategyState({ select, helper, optimizationStrategies, storage, storageKey: () => getUserId() ? `fsresibo-optimization-strategy-${getUserId()}` : null });
  return { select, helper, state };
};

test('visible strategy is the optimization snapshot, helper, details rule, and persisted user value', () => {
  let userId = 'user-a';
  const storage = makeStorage();
  const { select, helper, state } = makeState(storage, () => userId);
  const expectations = [
    [optimizationStrategies.closest, 200500, 6],
    [optimizationStrategies.fewest, 203000, 3],
    [optimizationStrategies.withoutExceeding, 200500, 6]
  ];

  for (const [visibleStrategy, total, receiptCount] of expectations) {
    select.value = visibleStrategy;
    const strategy = state.setActiveStrategy(state.getActiveStrategy());
    const result = findBest(receipts, targetCents, strategy);
    assert.equal(strategy, visibleStrategy);
    assert.equal(result.total, total);
    assert.equal(result.items.length, receiptCount);
    assert.equal(helper.textContent, optimizationStrategyDetails[strategy].helper);
    assert.match(optimizationStrategyRules[strategy], strategy === optimizationStrategies.fewest ? /fewest receipts within 2%/ : strategy === optimizationStrategies.withoutExceeding ? /at or below/ : /closest total/);
    assert.equal(storage.getItem(`fsresibo-optimization-strategy-${userId}`), strategy);
  }
});

test('browser-restored select values, session restoration, workspace return, logout, and users stay synchronized', () => {
  let userId = 'user-a';
  const storage = makeStorage();
  const first = makeState(storage, () => userId);
  first.state.setActiveStrategy(optimizationStrategies.fewest);
  assert.equal(storage.getItem('fsresibo-optimization-strategy-user-a'), optimizationStrategies.fewest);

  const restored = makeState(storage, () => userId);
  assert.equal(restored.state.restoreActiveStrategy(), optimizationStrategies.fewest);
  assert.equal(restored.select.value, optimizationStrategies.fewest);
  assert.equal(restored.helper.textContent, optimizationStrategyDetails.fewest.helper);
  assert.equal(restored.state.getActiveStrategy(), optimizationStrategies.fewest);

  restored.select.value = optimizationStrategies.closest;
  restored.select.value = optimizationStrategies.fewest;
  assert.equal(restored.state.setActiveStrategy(restored.state.getActiveStrategy()), optimizationStrategies.fewest);

  restored.state.setActiveStrategy(optimizationStrategies.closest, { persist: false });
  assert.equal(restored.select.value, optimizationStrategies.closest);
  assert.equal(storage.getItem('fsresibo-optimization-strategy-user-a'), optimizationStrategies.fewest);
  assert.equal(restored.state.restoreActiveStrategy(), optimizationStrategies.fewest);

  userId = 'user-b';
  const otherUser = makeState(storage, () => userId);
  assert.equal(otherUser.state.restoreActiveStrategy(), optimizationStrategies.closest);
  assert.equal(otherUser.select.value, optimizationStrategies.closest);
});
