// CP10-C3E-2: the review view and the pure ordering helpers, tested without the receipt UI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { describeFieldChanges, moveBy, moveId, partitionExportProblems, sameMembers, summarizeAmounts } from '../domain/exportArrangement.js';
import { buildReviewRow, createExportReview } from '../ui/exportReview.js';

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const format = cents => peso.format(cents / 100);
const formatDate = value => value || 'Date not set';
const entry = { dbId: 'r1', label: 'Receipt 1' };

test('X: a missing amount is "No amount", an explicit zero is ₱0.00, and a valid amount is formatted; none is confused with another', () => {
  const missing = buildReviewRow(entry, { amount: '', store: 'A' }, '', { format, formatDate });
  const blankNull = buildReviewRow(entry, { amount: null, store: 'A' }, '', { format, formatDate });
  const zero = buildReviewRow(entry, { amount: 0, store: 'A' }, '', { format, formatDate });
  const zeroText = buildReviewRow(entry, { amount: '0.00', store: 'A' }, '', { format, formatDate });
  const valid = buildReviewRow(entry, { amount: 1250.5, store: 'A' }, '', { format, formatDate });
  assert.deepEqual([missing.amountText, missing.amountMissing], ['No amount', true]);
  assert.deepEqual([blankNull.amountText, blankNull.amountMissing], ['No amount', true]);
  assert.equal(zero.amountText.replace(/\s/g, ''), '₱0.00'); assert.equal(zero.amountMissing, false);
  assert.equal(zeroText.amountText.replace(/\s/g, ''), '₱0.00'); assert.equal(zeroText.amountMissing, false);
  assert.equal(valid.amountText.replace(/\s/g, ''), '₱1,250.50');
  assert.equal(buildReviewRow(entry, { amount: '12,34.50' }, '', { format, formatDate }).amountText, 'Invalid amount');
});

test('X: review rows show store, invoice and date fallbacks and carry the receipt number', () => {
  const row = buildReviewRow({ dbId: 'r9', label: 'Receipt 9' }, { amount: 5, store: '  ', invoice: ' ', receiptDate: '' }, 'note', { format, formatDate });
  assert.deepEqual([row.id, row.label, row.store, row.invoice, row.date, row.note], ['r9', 'Receipt 9', 'Store not set', 'No invoice number', 'Date not set', 'note']);
  assert.equal(buildReviewRow(entry, { amount: 5, store: 'S', invoice: 'INV-7' }, undefined, { format, formatDate }).invoice, 'Invoice INV-7');
});

test('X: the summary counts receipts, receipts without an amount, and sums only real amounts in exact centavos', () => {
  assert.deepEqual(summarizeAmounts([{ amount: 1250.5 }, { amount: '' }, { amount: 0 }, { amount: null }, { amount: 0.1 }, { amount: 0.2 }]), { count: 6, withoutAmount: 2, validCents: 125080 });
  assert.deepEqual(summarizeAmounts([]), { count: 0, withoutAmount: 0, validCents: 0 });
  assert.equal(summarizeAmounts([{ amount: '' }]).validCents, 0, 'missing amounts add nothing, but are counted separately');
});

test('ordering helpers keep the members, clamp positions and never mutate their input', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveId(order, 'c', 0), ['c', 'a', 'b', 'd']);
  assert.deepEqual(moveId(order, 'a', 99), ['b', 'c', 'd', 'a']);
  assert.deepEqual(moveId(order, 'b', -5), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moveBy(order, 'b', 1), ['a', 'c', 'b', 'd']);
  assert.deepEqual(moveBy(order, 'a', -1), order, 'moving the first receipt up changes nothing');
  assert.deepEqual(moveId(order, 'zzz', 1), order);
  assert.deepEqual(order, ['a', 'b', 'c', 'd']);
  for (const id of order) for (let to = 0; to < 4; to += 1) assert.equal(sameMembers(moveId(order, id, to), order), true);
  assert.equal(sameMembers(['a', 'b'], ['a', 'c']), false); assert.equal(sameMembers(['a', 'a'], ['a', 'a']), false, 'duplicates are not a valid order');
  assert.equal(sameMembers(['a'], ['a', 'b']), false);
});

test('changes are split into those that need recalculation and those that can be acknowledged', () => {
  const problems = [
    { type: 'changed', dbId: 'r1', fields: ['store', 'updatedAt'] },
    { type: 'changed', dbId: 'r2', fields: ['amount', 'updatedAt'] },
    { type: 'changed', dbId: 'r3', fields: ['updatedAt'] },
    { type: 'optimizerChanged', dbId: 'r4' }, { type: 'unavailable', dbId: 'r5' }, { type: 'missing', dbId: 'r6' }, { type: 'invalidAmount', dbId: 'r7' }
  ];
  const { hard, soft } = partitionExportProblems(problems);
  assert.deepEqual(soft.map(problem => problem.dbId), ['r1', 'r3']);
  assert.deepEqual(hard.map(problem => problem.dbId), ['r2', 'r4', 'r5', 'r6', 'r7']);
  assert.deepEqual(describeFieldChanges({ store: 'Old', invoice: '' }, { store: 'New', invoice: 'X' }, ['store', 'invoice']), [{ field: 'store', label: 'Store name', before: 'Old', after: 'New' }, { field: 'invoice', label: 'Invoice number', before: '', after: 'X' }]);
});

// ---- the view, with a tiny fake DOM ---------------------------------------------------------------------------------------------------------
function fakeDom() {
  const focusLog = [];
  const make = () => {
    const el = { children: [], listeners: {}, attrs: {}, dataset: {}, className: '', textContent: '', disabled: false, hidden: false, checked: false,
      setAttribute(name, value) { el.attrs[name] = String(value); }, getAttribute: name => el.attrs[name] ?? null,
      append(...nodes) { el.children.push(...nodes); }, replaceChildren(...nodes) { el.children = nodes; },
      addEventListener(name, listener) { (el.listeners[name] ??= []).push(listener); },
      emit(name, event = {}) { (el.listeners[name] ?? []).forEach(listener => listener({ currentTarget: el, preventDefault() {}, ...event })); },
      focus() { focusLog.push(el); } };
    return el;
  };
  return { make, focusLog };
}

function viewFixture(rows) {
  const dom = fakeDom();
  const state = { order: rows.map(row => row.id), moves: [], resets: 0, acknowledged: [] };
  const els = { list: dom.make(), announcer: dom.make(), reset: dom.make(), summary: { count: dom.make(), total: dom.make(), noAmountGroup: dom.make(), noAmount: dom.make() }, acknowledgement: { group: dom.make(), text: dom.make(), input: dom.make() } };
  const model = () => ({ rows: state.order.map(id => rows.find(row => row.id === id)), totalText: '₱0.00', withoutAmount: rows.filter(row => row.amountMissing).length, canReset: true, acknowledgement: null });
  const view = createExportReview({ ...els, createElement: dom.make, onMove: (id, to) => { state.moves.push([id, to]); state.order = moveId(state.order, id, to); view.render(model()); }, onReset: () => { state.resets += 1; }, onAcknowledge: checked => state.acknowledged.push(checked) });
  view.start(); view.render(model());
  return { view, state, els, dom, model };
}
const sample = ['r1', 'r2', 'r3'].map((id, index) => ({ id, label: `Receipt ${index + 1}`, store: `Store ${index + 1}`, invoice: 'No invoice number', date: 'Date not set', amountText: index === 1 ? 'No amount' : '₱1.00', amountMissing: index === 1, note: '' }));

test('the view renders one numbered row per receipt with labelled controls and flags rows without an amount', () => {
  const { els } = viewFixture(sample);
  const rows = els.list.children;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.reviewParts.position.textContent), ['1', '2', '3']);
  assert.equal(rows[1].reviewParts.amount.textContent, 'No amount');
  assert.match(rows[1].reviewParts.amount.className, /is-missing/);
  assert.match(rows[1].className, /has-no-amount/);
  assert.equal(rows[0].reviewParts.handle.getAttribute('aria-label'), 'Reorder Receipt 1, position 1 of 3');
  assert.equal(rows[0].reviewParts.handle.getAttribute('aria-describedby'), 'exportReviewHint');
  assert.equal(els.list.getAttribute('aria-label'), 'Receipts in export order, 3 in total');
  assert.equal(els.summary.noAmountGroup.hidden, false);
  assert.match(els.summary.noAmount.textContent, /^1 without an amount \(not counted in the total\)$/);
  assert.equal(els.summary.count.textContent, '3');
});

test('every control reports the same move request, and out-of-range keyboard moves are clamped and announced', () => {
  const { els, state } = viewFixture(sample);
  const parts = id => els.list.children.find(row => row.dataset.receiptId === id).reviewParts;
  parts('r2').up.emit('click'); parts('r2').handle.emit('keydown', { key: 'ArrowDown' }); parts('r3').handle.emit('keydown', { key: 'Home' }); parts('r3').handle.emit('keydown', { key: 'End' });
  assert.deepEqual(state.moves, [['r2', 0], ['r2', 1], ['r3', 0], ['r3', 2]]);
  parts('r3').handle.emit('keydown', { key: 'End' });
  assert.equal(state.moves.length, 4, 'End on the last receipt asks for nothing');
  assert.match(els.announcer.textContent, /^Receipt 3 is already at position 3 of 3\./);
});

test('the acknowledgement group follows the model and reports changes of the checkbox', () => {
  const { view, els, state, model } = viewFixture(sample);
  assert.equal(els.acknowledgement.group.hidden, true);
  view.render({ ...model(), acknowledgement: { text: 'Please review', checked: true } });
  assert.equal(els.acknowledgement.group.hidden, false); assert.equal(els.acknowledgement.text.textContent, 'Please review'); assert.equal(els.acknowledgement.input.checked, true);
  els.acknowledgement.input.checked = false; els.acknowledgement.input.emit('change');
  assert.deepEqual(state.acknowledged, [false]);
  view.clear();
  assert.equal(els.list.children.length, 0); assert.equal(els.acknowledgement.group.hidden, true); assert.equal(els.announcer.textContent, '');
});

test('the view holds no export, storage or database logic and no pointer-drag code (that is C3E-3)', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../ui/exportReview.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|supabase|fetch\(|consumeReceipts|downloadSelectedReceipts|loadReceipts/);
  assert.doesNotMatch(source, /pointerdown|pointermove|dragstart|draggable|setPointerCapture/);
});

test('keyboard: the whole row is the focusable target (tabindex 0, named and described), keys work on the row only, and the buttons keep their own meaning', () => {
  const { els, state } = viewFixture(sample);
  const first = els.list.children[0];
  assert.equal(first.getAttribute('tabindex'), '0');
  assert.equal(first.getAttribute('aria-label'), 'Reorder Receipt 1, position 1 of 3');
  assert.equal(first.getAttribute('aria-describedby'), 'exportReviewHint');
  assert.equal(first.reviewParts.handle, first, 'the keyboard target is the row itself');
  assert.equal(first.reviewParts.row, first);
  assert.equal(first.children.length, 4, 'position, details, amount and the two buttons: no separate handle control');
  const buttons = [first.reviewParts.up, first.reviewParts.down];
  assert.deepEqual(buttons.map(button => button.getAttribute('aria-label')), ['Move Receipt 1 up', 'Move Receipt 1 down']);
  assert.equal(buttons.every(button => button.getAttribute('type') === 'button'), true);
  for (const key of ['ArrowDown', 'End']) first.emit('keydown', { key, target: first.reviewParts.up }); // pressed while a button is focused
  assert.deepEqual(state.moves, [], 'keys pressed on a button are not treated as row moves');
  first.emit('keydown', { key: 'ArrowDown', target: first }); assert.deepEqual(state.moves, [['r1', 1]]);
});

test('keyboard: ArrowUp/ArrowDown/Home/End on the row, the live announcement, and focus on the same row afterwards', () => {
  const { els, state, dom } = viewFixture(sample);
  const row = id => els.list.children.find(item => item.dataset.receiptId === id);
  row('r3').emit('keydown', { key: 'Home', target: row('r3') });
  assert.deepEqual(state.moves.at(-1), ['r3', 0]); assert.match(els.announcer.textContent, /^Receipt 3 moved to position 1 of 3\./);
  assert.equal(dom.focusLog.at(-1), row('r3'), 'focus returns to the moved row');
  row('r3').emit('keydown', { key: 'ArrowDown', target: row('r3') }); assert.deepEqual(state.moves.at(-1), ['r3', 1]);
  row('r3').emit('keydown', { key: 'End', target: row('r3') }); assert.deepEqual(state.moves.at(-1), ['r3', 2]);
  row('r3').emit('keydown', { key: 'ArrowUp', target: row('r3'), shiftKey: true }); assert.equal(state.moves.length, 3, 'modified keys are ignored');
});
