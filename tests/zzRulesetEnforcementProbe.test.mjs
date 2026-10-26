import test from 'node:test';
import assert from 'node:assert/strict';

// DISPOSABLE: deliberately failing test to prove the main ruleset blocks a red PR. Never merge.
test('ruleset enforcement probe fails on purpose', () => {
  assert.equal(1, 2);
});
