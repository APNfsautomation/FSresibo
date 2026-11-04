// Issue #50: Expense Account / Classification of Expense in Monthly Filing, driven through the real Monthly Filing UI.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { monthlyFixture, savedMonthly } from './helpers/monthlyFilingUiFixture.mjs';
import { monthlyFilingEditableFields, monthlyFilingSignature, runMonthlyFilingExport, reconcileMonthlyFilingReload } from '../ui/monthlyFilingUi.js';
import { expenseExportProblems } from '../domain/expenseClassification.js';

const user = { id: 'user-1' };
const blankPair = { expenseAccount: '', classification: '' };
const clearPair = (f, card) => { f.field(card, 'expenseAccount').value = ''; f.field(card, 'classification').value = ''; };
const ready = async records => { const f = monthlyFixture({ records }); await f.ui.loadForUser(user); return f; };

test('MF-1: both fields are editable monthly fields, part of the unsaved signature, and survive a reload merge', () => {
  assert.ok(monthlyFilingEditableFields.includes('expenseAccount') && monthlyFilingEditableFields.includes('classification'));
  const base = savedMonthly('a');
  assert.notEqual(monthlyFilingSignature(base), monthlyFilingSignature({ ...base, classification: 'Water' }), 'choosing a classification is an unsaved change');
  const merged = reconcileMonthlyFilingReload([{ ...base, classification: 'Water' }], [{ ...base }]);
  assert.equal(merged[0].classification, 'Water', 'a local, unsaved choice is not lost by a reload');
});

test('MF-2: Save works with both fields blank (optional on save) and persists a chosen pair', async () => {
  const f = await ready([]);
  await f.click(f.elements.add); const [card] = f.cards();
  await f.edit(card, 'store', 'Blank Store'); await f.edit(card, 'amount', '10'); clearPair(f, card);
  await f.click(f.elements.save);
  assert.equal(f.calls.create.length, 1); assert.deepEqual([f.calls.create[0].expenseAccount, f.calls.create[0].classification], ['', '']);
  const saved = f.cards()[0]; f.field(saved, 'expenseAccount').value = 'Project Expense'; await f.field(saved, 'expenseAccount').emit('input');
  f.field(saved, 'classification').value = 'Trade Show Fees'; await f.field(saved, 'classification').emit('input');
  await f.click(f.elements.save);
  assert.deepEqual([f.calls.update.at(-1)[1].expenseAccount, f.calls.update.at(-1)[1].classification], ['Project Expense', 'Trade Show Fees']);
});

test('MF-3: Export & Archive with missing fields is blocked before the confirmation: receipts and fields named, nothing saved, generated or archived, typed edits kept', async () => {
  const f = await ready([savedMonthly('a', blankPair), savedMonthly('b'), savedMonthly('c', { expenseAccount: 'Day to day', classification: '' })]);
  await f.edit(f.cards()[1], 'store', 'Edited but unsaved');
  const before = JSON.stringify([...f.table.values()]);
  await f.click(f.elements.exportActive);
  const message = f.elements.feedback.textContent;
  assert.match(message, /Receipt 1 needs Expense Account and Classification of Expense\./); assert.match(message, /Receipt 3 needs Classification of Expense\./);
  assert.doesNotMatch(message, /Receipt 2/); assert.match(message, /Nothing was exported and no receipt status was changed\./);
  assert.equal(f.calls.create.length + f.calls.update.length, 0, 'nothing was saved'); assert.equal(f.calls.workbook.length, 0); assert.equal(f.calls.archive.length, 0);
  assert.equal(JSON.stringify([...f.table.values()]), before, 'no record or status changed');
  assert.equal(f.field(f.cards()[1], 'store').value, 'Edited but unsaved', 'the typed edit is preserved');
  assert.equal(f.state.activeElement, f.field(f.cards()[0], 'expenseAccount'), 'focus goes to the first missing field of the first receipt that needs it');
});

test('MF-4: a complete set exports with the expense columns, archives the exact ids, and a receipt outside the export (Archived, incomplete) never blocks', async () => {
  const f = await ready([savedMonthly('a', { expenseAccount: 'Project Expense', classification: 'Hotel' }), savedMonthly('old', { status: 'archived', ...blankPair })]);
  await f.click(f.elements.exportActive);
  assert.equal(f.calls.workbook.length, 1); assert.deepEqual([f.calls.workbook[0][0].expenseAccount, f.calls.workbook[0][0].classification], ['Project Expense', 'Hotel']);
  assert.deepEqual(f.calls.archive, [['a']]);
});

test('MF-5: authoritative recheck: if the saved snapshot still lacks a field, no workbook is generated and nothing is archived', async () => {
  const events = [];
  const result = await runMonthlyFilingExport({
    save: async () => true, snapshot: () => [{ dbId: 'x', expenseAccount: 'Day to day', classification: '' }],
    generateWorkbook: () => events.push('workbook'), archive: async () => events.push('archive'),
    validate: saved => expenseExportProblems(saved.map((record, index) => ({ label: `Receipt ${index + 1}`, receipt: record })))
  });
  assert.equal(result.state, 'expense-missing'); assert.deepEqual(result.problems.map(problem => problem.fields), [['classification']]); assert.deepEqual(events, []);
  const ok = await runMonthlyFilingExport({ save: async () => true, snapshot: () => [{ dbId: 'x', expenseAccount: 'Day to day', classification: 'Water' }], generateWorkbook: () => events.push('workbook'), archive: async ids => { events.push('archive'); return ids; }, validate: () => [] });
  assert.equal(ok.state, 'archived'); assert.deepEqual(events, ['workbook', 'archive'], 'unchanged order: workbook, then archive');
});

test('MF-6: archived history stays readable and read-only with blank expense values', async () => {
  const f = await ready([savedMonthly('old', { status: 'archived', ...blankPair })]);
  await f.click(f.elements.archivedTab);
  const [card] = f.cards();
  assert.equal(f.field(card, 'expenseAccount').value, ''); assert.equal(f.field(card, 'classification').value, '');
  assert.equal(f.table.get('old').status, 'archived');
});

test('MF-7: the Monthly card markup exposes both fields with labels and no datalist', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Expense Account<input class="monthly-expenseAccount"/); assert.match(html, /Classification of Expense<input class="monthly-classification"/);
});
