// Issue #50: Expense Account / Classification of Expense in Receipt Encoding and Receipt Optimization export, driven through the real receipt UI.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { receiptFixture, settle } from './helpers/receiptUiFixture.mjs';
import { attachOptionCombobox } from '../ui/optionCombobox.js';
import { classificationOptions, expenseAccountOptions } from '../domain/expenseClassification.js';

const saved = (dbId, amount, store, extra = {}) => ({ dbId, amount, store, receiptDate: '2026-08-01', ...extra });
const toManual = async f => { f.elements.exportModeManual.checked = true; f.elements.exportModeBestMatch.checked = false; await f.elements.exportModeManual.emit('change'); return f; };
const card = (f, store) => f.cards().find(item => item.part('.compact-store').textContent === store);
const pick = (f, store) => card(f, store).part('.manual-select').emit('change');
const dialogOpen = f => f.elements.exportConfirmModal.hidden === false;
const rowOf = (f, store) => f.rows().find(row => f.field(row, 'store').value === store);

const threeReceipts = () => [
  saved('r1', 100, 'Store A', { expenseAccount: 'Day to day', classification: 'Meals' }),
  saved('r2', 200, 'Store B', { expenseAccount: '', classification: '' }),
  saved('r3', 300, 'Store C', { expenseAccount: 'Project Expense', classification: '' })
];

test('ENC-1: loaded receipts carry their Expense Account and Classification into the card fields; old blank rows stay blank (nothing is defaulted)', async () => {
  const f = await receiptFixture({ loaded: threeReceipts() });
  assert.deepEqual([f.field(rowOf(f, 'Store A'), 'expenseAccount').value, f.field(rowOf(f, 'Store A'), 'classification').value], ['Day to day', 'Meals']);
  assert.deepEqual([f.field(rowOf(f, 'Store B'), 'expenseAccount').value, f.field(rowOf(f, 'Store B'), 'classification').value], ['', '']);
});

test('ENC-2: Save is allowed with both fields blank (optional on save) and writes NULL-equivalent blanks, never a default', async () => {
  const f = await receiptFixture({ loaded: [] });
  await f.click(f.elements.floatingAdd); const row = f.rows()[0];
  await f.type(row, 'store', 'New Store'); await f.type(row, 'amount', '50');
  await f.click(f.elements.saveDraft);
  assert.equal(f.calls.create.length, 1);
  assert.equal(f.calls.create[0].expenseAccount ?? '', ''); assert.equal(f.calls.create[0].classification ?? '', '');
});

test('ENC-3: both fields are saved with the receipt and persist across a reload', async () => {
  const f = await receiptFixture({ loaded: [] });
  await f.click(f.elements.floatingAdd); const row = f.rows()[0];
  await f.type(row, 'store', 'Store Z'); await f.type(row, 'amount', '75');
  f.field(row, 'expenseAccount').value = 'Project Expense'; await f.field(row, 'expenseAccount').emit('input');
  f.field(row, 'classification').value = 'Meals w/ Customer'; await f.field(row, 'classification').emit('input');
  await f.click(f.elements.saveDraft);
  assert.deepEqual([f.calls.create[0].expenseAccount, f.calls.create[0].classification], ['Project Expense', 'Meals w/ Customer']);
  await f.ui.loadForUser({ id: 'user-1' }); await settle();
  const reloaded = f.rows().find(item => f.field(item, 'store').value === 'Store Z');
  assert.deepEqual([f.field(reloaded, 'expenseAccount').value, f.field(reloaded, 'classification').value], ['Project Expense', 'Meals w/ Customer']);
});

test('ENC-4: choosing a value after load marks the receipt unsaved, so the choice is never silently lost', async () => {
  const f = await receiptFixture({ loaded: threeReceipts() });
  const row = rowOf(f, 'Store B');
  assert.notEqual(row.dataset.unsavedKind, 'changes');
  f.field(row, 'expenseAccount').value = 'Day to day'; await f.field(row, 'expenseAccount').emit('input');
  assert.equal(row.dataset.unsavedKind, 'changes');
  await f.click(f.elements.saveDraft);
  assert.equal(f.calls.update.at(-1)[1].expenseAccount, 'Day to day');
});

test('ENC-5 (Issue #56): an incomplete selection opens Review & Arrange, but nothing is saved, downloaded or consumed until every receipt is complete', async () => {
  const f = await receiptFixture({ loaded: threeReceipts() }); await toManual(f);
  await pick(f, 'Store A'); await pick(f, 'Store B'); await pick(f, 'Store C');
  const before = JSON.stringify([...f.db.values()]);
  await f.click(f.elements.manualExportSelected);
  assert.equal(dialogOpen(f), true, 'missing expense fields no longer keep the review from opening');
  assert.equal(f.elements.exportReviewReadiness.textContent, 'Export readiness: 1 of 3 receipts complete');
  await f.click(f.elements.confirmExport);
  assert.match(f.elements.exportConfirmMessage.textContent, /still need an Expense Account and a Classification of Expense\. Nothing was saved or exported\./);
  assert.equal(dialogOpen(f), true);
  assert.equal(f.calls.download.length, 0); assert.equal(f.calls.consume.length, 0); assert.equal(f.calls.expenseSave, undefined);
  assert.equal(JSON.stringify([...f.db.values()]), before, 'no receipt was changed: statuses, values and timestamps are intact');
});

test('ENC-6: only the exact selection is validated: an incomplete receipt that is not selected never blocks the export', async () => {
  const f = await receiptFixture({ loaded: threeReceipts() }); await toManual(f);
  await pick(f, 'Store A');
  await f.click(f.elements.manualExportSelected);
  assert.equal(dialogOpen(f), true);
  await f.click(f.elements.confirmExport);
  assert.equal(f.calls.download.length, 1); assert.deepEqual(f.calls.consume, [['r1']]);
  assert.equal(f.db.get('r2').status, 'available'); assert.equal(f.db.get('r3').status, 'available');
});

test('ENC-7: the workbook carries the saved Expense Account and Classification of Expense of each exported receipt', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A', { expenseAccount: 'Project Expense', classification: 'Accomodation' }), saved('r2', 50, 'Store B', { expenseAccount: 'Day to day', classification: 'Water' })] }); await toManual(f);
  await pick(f, 'Store B'); await pick(f, 'Store A');
  await f.click(f.elements.manualExportSelected); await f.click(f.elements.confirmExport);
  assert.deepEqual(f.calls.download[0].map(item => [item.store, item.expenseAccount, item.classification]), [['Store B', 'Day to day', 'Water'], ['Store A', 'Project Expense', 'Accomodation']]);
});

test('ENC-8: a value another session blanked after the screen was checked is caught by the authoritative snapshot, before any workbook or status change', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A', { expenseAccount: 'Day to day', classification: 'Meals' })] }); await toManual(f);
  await pick(f, 'Store A'); await f.click(f.elements.manualExportSelected);
  assert.equal(dialogOpen(f), true);
  f.db.set('r1', { ...f.db.get('r1'), classification: '', updatedAt: f.stamp() });
  await f.click(f.elements.confirmExport);
  assert.equal(f.calls.download.length, 0); assert.equal(f.calls.consume.length, 0); assert.equal(f.db.get('r1').status, 'available');
});

test('ENC-9: the quick-correction dialog never blanks the expense fields it does not show', async () => {
  const f = await receiptFixture({ loaded: [saved('r1', 100, 'Store A', { expenseAccount: 'Project Expense', classification: 'Hotel' })] });
  const submit = { disabled: false }; f.elements.editForm.querySelector = selector => /submit/.test(selector) ? submit : null;
  const target = f.rows()[0]; f.elements.editModal.dataset.receiptIndex = '0';
  f.elements.editAmount.value = '100'; f.elements.editStore.value = 'Store A corrected';
  for (const [key, field] of Object.entries({ editReceiptDate: 'receiptDate', editVat: 'vat', editInvoice: 'invoice', editAddress: 'address', editTin: 'tin' })) f.elements[key].value = f.field(target, field).value;
  f.elements.editModal.hidden = false;
  await f.elements.editForm.emit('submit', { submitter: submit }); await settle();
  assert.deepEqual([f.calls.update[0][1].expenseAccount, f.calls.update[0][1].classification], ['Project Expense', 'Hotel']);
  assert.deepEqual([f.db.get('r1').expenseAccount, f.db.get('r1').classification], ['Project Expense', 'Hotel']);
});

// ---- the combobox itself, against a minimal fake DOM ----------------------------------------------------------------------------------------
function fakeCombobox(options, initial = '') {
  const makeNode = () => { const node = { value: '', hidden: false, id: '', children: [], attrs: {}, listeners: {}, dispatched: [], className: '', textContent: '',
    setAttribute(name, value) { node.attrs[name] = String(value); }, removeAttribute(name) { delete node.attrs[name]; }, getAttribute: name => node.attrs[name] ?? null,
    addEventListener(name, listener) { (node.listeners[name] ??= []).push(listener); }, replaceChildren(...items) { node.children = items; },
    dispatchEvent(event) { node.dispatched.push(event.type); return true; } }; return node; };
  globalThis.document ??= {}; const previous = globalThis.document.createElement; globalThis.document.createElement = makeNode;
  const input = makeNode(); const list = makeNode(); input.value = initial;
  const commits = []; const box = attachOptionCombobox({ input, list, options, label: 'Test', onCommit: value => commits.push(value) });
  const fire = (name, event = {}) => (input.listeners[name] ?? []).forEach(listener => listener({ preventDefault() { event.prevented = true; }, stopPropagation() { event.stopped = true; }, ...event }));
  const type = text => { input.value = text; fire('input'); };
  const key = (name, extra = {}) => { const event = { key: name, ...extra }; fire('keydown', event); return event; };
  return { input, list, box, commits, fire, type, key, restore: () => { globalThis.document.createElement = previous; } };
}

test('ENC-10: D then Tab commits Day to day and P then Tab commits Project Expense (Tab still moves focus: it is not prevented)', () => {
  for (const [typed, expected] of [['d', 'Day to day'], ['P', 'Project Expense']]) {
    const c = fakeCombobox(expenseAccountOptions); c.fire('focus'); c.type(typed);
    assert.deepEqual(c.box.options(), [expected]); assert.equal(c.input.attrs['aria-expanded'], 'true');
    const tab = c.key('Tab'); assert.equal(tab.prevented, undefined, 'Tab is never trapped');
    assert.equal(c.input.value, expected); assert.deepEqual(c.commits, [expected]); assert.equal(c.list.hidden, true);
    assert.ok(c.input.dispatched.includes('input') && c.input.dispatched.includes('change'), 'the card sees the change and flags itself unsaved'); c.restore();
  }
});

test('ENC-11: typing alone selects nothing; arrows move, Enter commits the highlighted suggestion, Escape closes without choosing', () => {
  const c = fakeCombobox(classificationOptions); c.fire('focus'); c.type('mea');
  assert.deepEqual(c.box.options(), ['Meals', 'Meals w/ Customer']); assert.deepEqual(c.commits, []);
  c.key('ArrowDown'); assert.equal(c.input.attrs['aria-activedescendant'], `${c.list.id}-1`);
  const enter = c.key('Enter'); assert.equal(enter.prevented, true); assert.equal(c.input.value, 'Meals w/ Customer'); assert.deepEqual(c.commits, ['Meals w/ Customer']);
  c.type('wat'); const escape = c.key('Escape'); assert.equal(escape.prevented, true); assert.deepEqual(c.commits, ['Meals w/ Customer'], 'Escape chose nothing'); assert.equal(c.box.isOpen(), false); c.restore();
});

test('ENC-12: no uncontrolled free text: leaving the field with a non-option restores the last choice; an exact name is accepted; clearing is allowed', () => {
  const c = fakeCombobox(expenseAccountOptions, 'Day to day'); c.fire('focus');
  c.type('whatever'); c.fire('blur'); assert.equal(c.input.value, 'Day to day', 'junk text is not kept');
  c.fire('focus'); c.type('project expense'); c.fire('blur'); assert.equal(c.input.value, 'Project Expense', 'a typed exact name (any case) is normalized to the option');
  c.fire('focus'); c.type(''); c.fire('blur'); assert.equal(c.input.value, '', 'a blank choice is allowed until export'); assert.deepEqual(c.commits, ['Project Expense', '']);
  c.restore();
});

test('ENC-13: Ctrl+Enter and Ctrl+S pass through the combobox untouched, and IME composition is ignored', () => {
  const c = fakeCombobox(classificationOptions); c.fire('focus'); c.type('me');
  for (const extra of [{ key: 'Enter', ctrlKey: true }, { key: 's', ctrlKey: true }]) { const event = c.key(extra.key, { ctrlKey: true }); assert.equal(event.prevented, undefined); }
  assert.deepEqual(c.commits, []);
  const composing = c.key('Enter', { isComposing: true }); assert.equal(composing.prevented, undefined); assert.deepEqual(c.commits, []); c.restore();
});

test('ENC-14: the markup exposes both fields in the Encoding card, with accessible names and no native free-text datalist', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="receipt-expenseAccount"/); assert.match(html, /class="receipt-classification"/);
  assert.match(html, /Expense Account<input/); assert.match(html, /Classification of Expense<input/);
  assert.doesNotMatch(html, /<datalist/);
});

test('ENC-15 (Issue #56): unsaved edits still block the review and offer Go to Encoding; the missing expense fields no longer do', async () => {
  const f = await receiptFixture({ loaded: threeReceipts() }); await toManual(f);
  await pick(f, 'Store B');
  await f.type(rowOf(f, 'Store B'), 'amount', '250'); // unsaved edit on a receipt that also lacks both fields
  await f.click(f.elements.manualExportSelected);
  const message = f.elements.manualFeedback.textContent;
  assert.match(message, /has unsaved changes/); assert.doesNotMatch(message, /needs Expense Account/);
  assert.equal(f.elements.manualGoToEncoding.hidden, false);
  assert.equal(f.calls.snapshot.length, 0, 'blocked from the screen alone: no database read, no download, no status change');
  assert.equal(f.calls.download.length, 0); assert.equal(f.calls.consume.length, 0);
});
