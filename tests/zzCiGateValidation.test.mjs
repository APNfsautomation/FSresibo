// Deliberately failing test for the Issue #20 CI gate validation. Scratch branch only; never merged.
import assert from 'node:assert/strict';
import test from 'node:test';

test('CI gate validation: deliberate failure', () => {
  assert.equal(1, 2, 'This failure is intentional (Issue #20 scratch branch).');
});
