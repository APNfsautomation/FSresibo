// CP10-C3E-4: the pure rules for Manual Selection.
import assert from 'node:assert/strict';
import test from 'node:test';
import { addManual, fillShown, fillShownMessage, hiddenSelectedCount, isManuallySelectable, manualEligibility, manualLimitMessage, maximumManualSelection, pruneManual, removeManual, selectionFullMessage, summarizeManual, toggleManual } from '../domain/manualSelection.js';
import { maximumMoneyCents } from '../domain/moneyAmount.js';

const ids = n => Array.from({ length: n }, (_, i) => `id${i + 1}`);

test('only saved Available receipts are selectable; drafts and Consumed receipts are not', () => {
  assert.equal(manualEligibility({ dbId: 'a', status: 'available' }), 'ok');
  assert.equal(manualEligibility({ dbId: 'a', status: 'consumed' }), 'consumed');
  assert.equal(manualEligibility({ dbId: null, status: 'available' }), 'unsaved');
  assert.equal(manualEligibility({ dbId: undefined, status: 'consumed' }), 'unsaved');
  assert.deepEqual([{ dbId: 'a', status: 'available' }, { dbId: 'b', status: 'consumed' }, { status: 'available' }].map(isManuallySelectable), [true, false, false]);
});

test('an unknown or missing status is not selectable: only exactly Available is', () => {
  for (const status of ['unknown', 'Available', 'AVAILABLE', '', null, undefined, 0]) assert.equal(manualEligibility({ dbId: 'a', status }), 'unavailable', String(status));
  assert.equal(manualEligibility({ dbId: 'a' }), 'unavailable', 'missing status');
  assert.equal(manualEligibility({ dbId: '', status: 'available' }), 'unsaved');
  assert.equal(manualEligibility(), 'unsaved');
  assert.equal(isManuallySelectable({ dbId: 'a', status: 'pending' }), false);
});

test('picking appends to the end, in click order, by stable id, without duplicates', () => {
  let selected = [];
  for (const id of ['D', 'B', 'A', 'C']) selected = addManual(selected, id).ids;
  assert.deepEqual(selected, ['D', 'B', 'A', 'C'], 'the click order, not alphabetical, numeric or any display order');
  const again = addManual(selected, 'B'); assert.equal(again.changed, false); assert.deepEqual(again.ids, selected, 'no duplicate and no reordering');
});

test('deselecting removes the receipt; selecting it again puts it at the end', () => {
  const start = ['A', 'B', 'C'];
  const off = toggleManual(start, 'A'); assert.deepEqual([off.ids, off.action], [['B', 'C'], 'removed']);
  const on = toggleManual(off.ids, 'A'); assert.deepEqual([on.ids, on.action], [['B', 'C', 'A'], 'added']);
  assert.deepEqual(removeManual(start, 'Z'), { ids: start, changed: false });
  assert.deepEqual(start, ['A', 'B', 'C'], 'inputs are never mutated');
});

test('the 100-receipt limit: the 100th is accepted, the 101st is rejected with nothing replaced or removed', () => {
  const full = ids(99); const hundred = addManual(full, 'id100'); assert.equal(hundred.ids.length, 100); assert.equal(maximumManualSelection, 100);
  const rejected = addManual(hundred.ids, 'extra');
  assert.deepEqual([rejected.changed, rejected.rejected], [false, 'limit']); assert.deepEqual(rejected.ids, hundred.ids, 'no silent removal or replacement');
  assert.deepEqual(toggleManual(hundred.ids, 'extra').rejected, 'limit');
  assert.equal(toggleManual(hundred.ids, 'id7').ids.length, 99, 'deselecting still works at the limit');
  assert.match(manualLimitMessage(), /up to 100 receipts/);
});

test('Select Shown appends only the shown receipts that are not yet selected, in shown order, and keeps hidden selections', () => {
  const result = fillShown(['H1', 'B'], ['A', 'B', 'C', 'A']);
  assert.deepEqual(result.ids, ['H1', 'B', 'A', 'C']); assert.deepEqual(result.added, ['A', 'C']);
  assert.deepEqual(fillShown(['A'], ['A']).added, [], 'nothing new: unchanged');
  assert.deepEqual(fillShown([], []).ids, []);
});

test('Select Shown fills only the remaining capacity, in shown order, and never reorders what is selected', () => {
  const shown = Array.from({ length: 400 }, (_, i) => `s${i + 1}`);
  const none = fillShown([], shown); assert.deepEqual(none.added, shown.slice(0, 100)); assert.equal(none.notAdded, 300); assert.equal(none.nowFull, true);
  const selected = ['h1', 'h2', ...ids(23)]; // 25 selected, two of them hidden (not shown)
  const part = fillShown(selected, shown);
  assert.deepEqual(part.ids.slice(0, 25), selected, 'earlier selections keep their positions'); assert.deepEqual(part.added, shown.slice(0, 75)); assert.equal(part.ids.length, 100);
  const next = fillShown(ids(75), ['id3', ...shown]); assert.deepEqual(next.added, shown.slice(0, 25), 'already selected ids are skipped, not counted');
  const full = fillShown(ids(100), shown); assert.deepEqual(full.added, []); assert.equal(full.wasFull, true); assert.equal(full.ids.length, 100);
  const few = fillShown(ids(10), ['x', 'y']); assert.deepEqual(few.added, ['x', 'y']); assert.equal(few.nowFull, false); assert.equal(few.notAdded, 0);
});

test('Select Shown messages report how many were added and when the capacity was reached', () => {
  const shown = Array.from({ length: 30 }, (_, i) => `s${i}`);
  assert.match(fillShownMessage(fillShown(ids(90), shown)), /^10 receipts added in the order shown\. The selection is now full at 100 of 100; 20 more shown receipts were not added\.$/);
  assert.match(fillShownMessage(fillShown(ids(98), shown)), /^2 receipts added in the order shown\. The selection is now full at 100 of 100; 28 more shown receipts were not added\.$/);
  assert.match(fillShownMessage(fillShown(ids(5), ['a'])), /^1 receipt added in the order shown\. 6 of 100 selected\.$/);
  assert.equal(fillShownMessage(fillShown(ids(100), shown)), selectionFullMessage());
  assert.equal(fillShownMessage(fillShown(['a'], ['a'])), 'Every selectable receipt shown is already selected.');
});

test('pruning reports what it removed and keeps the order of everything else', () => {
  const result = pruneManual(['A', 'B', 'C', 'D'], id => id !== 'B' && id !== 'D');
  assert.deepEqual([result.ids, result.removed], [['A', 'C'], ['B', 'D']]);
  const same = ['A']; assert.equal(pruneManual(same, () => true).ids, same);
});

test('hidden selections are counted from the full selection, not from what is visible', () => {
  assert.equal(hiddenSelectedCount(['A', 'B', 'C'], ['B']), 2); assert.equal(hiddenSelectedCount([], ['B']), 0); assert.equal(hiddenSelectedCount(['A'], ['A', 'Z']), 0);
});

test('the summary uses exact centavos: blank is not zero, zero stays in the count, and invalid amounts are not summed', () => {
  const saved = new Map([['A', { amount: 1000 }], ['B', { amount: '' }], ['C', { amount: 0 }], ['D', { amount: 500 }]]);
  assert.deepEqual(summarizeManual(['A', 'B', 'C', 'D'], saved), { count: 4, withoutAmount: 1, validCents: 150000 });
  const floats = new Map([['a', { amount: 0.1 }], ['b', { amount: 0.2 }], ['c', { amount: 0.7 }]]);
  assert.equal(summarizeManual(['a', 'b', 'c'], floats).validCents, 100, '0.1 + 0.2 + 0.7 is exactly 1.00, with no floating-point drift');
  assert.deepEqual(summarizeManual([], new Map()), { count: 0, withoutAmount: 0, validCents: 0 });
  assert.equal(summarizeManual(['a', 'b'], new Map([['a', { amount: null }], ['b', { amount: '  ' }]])).withoutAmount, 2);
  assert.equal(summarizeManual(['x'], new Map([['x', { amount: '12,34.50' }]])).validCents, 0, 'an invalid amount is never guessed at');
});

test('the largest possible selection (100 receipts at the maximum amount) stays an exact safe integer', () => {
  const saved = new Map(ids(100).map(id => [id, { amount: maximumMoneyCents / 100 }]));
  const summary = summarizeManual(ids(100), saved);
  assert.equal(summary.validCents, maximumMoneyCents * 100); assert.ok(Number.isSafeInteger(summary.validCents));
});
