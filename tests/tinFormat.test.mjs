// Issue #50 requirement 7: smart TIN formatting in both workspaces.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { editTin, formatTin, formatTinForDisplay, tinDigits, tinStatus } from '../domain/tinFormat.js';
import { attachTinFormatter } from '../ui/tinInput.js';
import { normalizeStoreTin, persistedStoreFingerprint, sharedProfileIdentity } from '../domain/sharedStoreProfiles.js';
import { monthlyFixture, savedMonthly } from './helpers/monthlyFilingUiFixture.mjs';
import { receiptFixture } from './helpers/receiptUiFixture.mjs';

test('TIN-1: 12 digits become 000-000-000-000 and 14 digits become 000-000-000-00000; leading zeros are kept', () => {
  assert.equal(formatTin('123456789012'), '123-456-789-012');
  assert.equal(formatTin('12345678901234'), '123-456-789-01234');
  assert.equal(formatTin('000000000000'), '000-000-000-000');
  assert.equal(formatTin('000123456000'), '000-123-456-000');
});

test('TIN-2: while typing, hyphens appear only between digits; nothing is dropped; letters and symbols are removed', () => {
  const steps = ['1', '12', '123', '1234', '123456', '1234567', '123456789', '1234567890', '123456789012'];
  assert.deepEqual(steps.map(formatTin), ['1', '12', '123', '123-4', '123-456', '123-456-7', '123-456-789', '123-456-789-0', '123-456-789-012']);
  assert.equal(formatTin(''), ''); assert.equal(formatTin(null), ''); assert.equal(formatTin('abc'), '');
  assert.equal(formatTin('TIN: 123 456 789.012'), '123-456-789-012');
  assert.equal(formatTin('1234567890123'), '123-456-789-0123', '13 digits are grouped, not truncated');
  assert.equal(formatTin('123456789012345'), '123-456-789-012345', 'extra digits are never silently dropped');
});

test('TIN-3: a pasted unformatted, spaced, dotted or already formatted TIN ends up in the same canonical shape', () => {
  for (const pasted of ['123456789012', '123 456 789 012', '123.456.789.012', '123-456-789-012', ' 123-456-789 012 ']) assert.equal(editTin({ previous: '', value: pasted, inputType: 'insertFromPaste' }).value, '123-456-789-012', pasted);
  assert.equal(editTin({ previous: '', value: '123456789012', caret: 12, inputType: 'insertFromPaste' }).caret, 15, 'the caret lands at the end of the pasted TIN');
});

test('TIN-4: the caret stays after the same digit when a digit is typed or inserted in the middle', () => {
  assert.deepEqual(editTin({ previous: '123', value: '1234', caret: 4, inputType: 'insertText' }), { value: '123-4', caret: 5 });
  assert.deepEqual(editTin({ previous: '123-456', value: '129-3456', caret: 3, inputType: 'insertText' }), { value: '129-345-6', caret: 3 });
  assert.deepEqual(editTin({ previous: '123-456', value: '1239-456', caret: 4, inputType: 'insertText' }), { value: '123-945-6', caret: 5 });
});

test('TIN-5: deleting a hyphen deletes the neighbouring digit instead of being undone (the caret is never trapped)', () => {
  assert.deepEqual(editTin({ previous: '123-456', value: '123456', caret: 3, inputType: 'deleteContentBackward' }), { value: '124-56', caret: 2 });
  assert.deepEqual(editTin({ previous: '123-456', value: '123456', caret: 3, inputType: 'deleteContentForward' }), { value: '123-56', caret: 3 });
  assert.deepEqual(editTin({ previous: '123-456', value: '123-45', caret: 6, inputType: 'deleteContentBackward' }), { value: '123-45', caret: 6 }, 'deleting a digit is an ordinary edit');
  assert.deepEqual(editTin({ previous: '123-4', value: '123-', caret: 4, inputType: 'deleteContentBackward' }), { value: '123', caret: 3 }, 'a dangling hyphen disappears');
  assert.deepEqual(editTin({ previous: '123', value: '', caret: 0, inputType: 'deleteContentBackward' }), { value: '', caret: 0 });
});

test('TIN-6: historical and autofilled values: purely numeric text is grouped, anything else (a note) is left as it is; matching is digits-only either way', () => {
  assert.equal(formatTinForDisplay('123456789012'), '123-456-789-012'); assert.equal(formatTinForDisplay('N/A'), 'N/A'); assert.equal(formatTinForDisplay(''), ''); assert.equal(formatTinForDisplay(undefined), '');
  assert.equal(formatTinForDisplay('123-456-789-012'), '123-456-789-012');
  assert.equal(tinDigits('123-456-789-012'), normalizeStoreTin('123456789012'));
  const store = tin => ({ store: 'Cafe', address: '1 Main', tin });
  assert.equal(persistedStoreFingerprint(store('123456789012')), persistedStoreFingerprint(store('123-456-789-012')), 'directory fingerprints ignore formatting');
  assert.equal(sharedProfileIdentity(store('000123456000')), sharedProfileIdentity(store('000-123-456-000')), 'leading zeros keep their identity');
  assert.notEqual(sharedProfileIdentity(store('123456789012')), sharedProfileIdentity(store('023456789012')));
  assert.deepEqual(['', '123', '123456789012', '12345678901234', '1234567890123'].map(tinStatus), ['empty', 'incomplete', 'complete', 'complete', 'incomplete']);
});

function fakeInput(value = '') {
  const input = { value, selectionStart: value.length, listeners: {}, dataset: {}, selection: null, addEventListener(name, listener) { (input.listeners[name] ??= []).push(listener); }, setSelectionRange(start) { input.selection = start; input.selectionStart = start; } };
  attachTinFormatter(input);
  const type = (text, extra = {}) => { input.value = text; input.selectionStart = extra.caret ?? text.length; (input.listeners.input ?? []).forEach(listener => listener(extra)); return input.value; };
  return { input, type, focus: () => (input.listeners.focus ?? []).forEach(listener => listener({})) };
}

test('TIN-7: the input formatter rewrites typed and pasted text, keeps the caret, leaves IME composition alone and attaches only once', () => {
  const f = fakeInput(); f.focus();
  assert.equal(f.type('1234'), '123-4'); assert.equal(f.input.selection, 5);
  assert.equal(f.type('123456789012', { inputType: 'insertFromPaste' }), '123-456-789-012');
  assert.equal(f.type('12', { isComposing: true }), '12', 'text being composed by an input method is not touched');
  const before = f.input.listeners.input.length; attachTinFormatter(f.input); assert.equal(f.input.listeners.input.length, before, 'a second attach adds nothing');
  const loaded = fakeInput('123456789012'); assert.equal(loaded.input.value, '123456789012', 'merely loading a historical value rewrites nothing');
});

test('TIN-8: Monthly Filing: an untouched historical unformatted TIN is never rewritten by loading or saving', async () => {
  const f = monthlyFixture({ records: [savedMonthly('old', { tin: '123456789012' })] }); await f.ui.loadForUser({ id: 'user-1' });
  const [card] = f.cards(); assert.equal(f.field(card, 'tin').value, '123456789012');
  await f.click(f.elements.save); assert.equal(f.calls.update[0][1].tin, '123456789012', 'Save sends the historical text exactly as stored; only an edit reformats it');
});

test('TIN-9: Receipt Encoding card, edit dialog, shared-store autofill and Monthly Filing all route the TIN through the formatter', async () => {
  const f = await receiptFixture({ loaded: [{ dbId: 'r1', amount: 10, store: 'Store A', tin: '123456789012' }] });
  assert.equal(f.field(f.rows()[0], 'tin').value, '123456789012', 'loading never rewrites a stored TIN');
  const ui = await readFile(new URL('../ui/receiptUi.js', import.meta.url), 'utf8'); const monthly = await readFile(new URL('../ui/monthlyFilingUi.js', import.meta.url), 'utf8');
  assert.match(ui, /attachTinFormatter\(row\.querySelector\('\.receipt-tin'\)\)/); assert.match(ui, /attachTinFormatter\(elements\.editTin\)/); assert.match(ui, /formatTinForDisplay\(values\.tin\)/);
  assert.match(monthly, /attachTinFormatter\(row\.querySelector\('\.monthly-tin'\)\)/); assert.match(monthly, /key === 'tin' \? formatTinForDisplay\(value\)/);
});
