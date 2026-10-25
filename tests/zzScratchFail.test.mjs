// SCRATCH VALIDATION ONLY (Issue #36). Intentionally failing probe; this branch and its pull request are never merged.
import test from 'node:test';
import assert from 'node:assert/strict';
test('SCRATCH: intentionally failing probe', () => { assert.fail('intentional failure for pr-readiness validation'); });
